import "server-only";
import type { IChatEvent, IChatRequest, IUsage, LogEntry } from "../../types";
import { authToken, modelAllowed, tokenDeny, type Deny, type TokenCtx } from "../tokens";
import { captured, newCtx, type ReqCtx } from "./capture";
import { addLog, listChannels } from "../store";
import { persistRemoteImage, resolveImage, saveFile } from "../files";
import { absoluteImageUrl, publicOrigin } from "../imgurl";
import { adapterChat, adapterImage } from "./adapters";
import { openaiHeaders, openaiUrl } from "./adapters/openai";
import { ANTHROPIC_VERSION, claudeHeaders } from "./adapters/claude";
import { geminiHeaders, geminiUrl } from "./adapters/gemini";
import { fetchUpstream, RelayError } from "./errors";
import {
  claudeError,
  claudeJSON,
  claudeSSE,
  collect,
  fromClaude,
  fromGemini,
  fromOpenAI,
  geminiError,
  geminiJSON,
  geminiStream,
  openaiError,
  openaiJSON,
  openaiSSE,
} from "./formats";
import { buildCatalog, inlineImages, logFailure, withFailover, withLogging, type FailoverError } from "./router";
import { readSSE, SSE_HEADERS, streamFrom } from "./sse";
import { familyOf, type Target } from "./target";
import { isDbDown, type DbDownError } from "../mysql";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export function cors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

type Source = "openai" | "claude" | "gemini";
type Attempt = { raw: Response } | { events: AsyncGenerator<IChatEvent> };

function rawLogger(source: LogEntry["source"], model: string, t: Target, attempts: number, startedAt: number, stream: boolean, ctx: ReqCtx) {
  return async (usage?: IUsage, ttfb?: number, error?: string) => {
    await addLog({
      source,
      model,
      upstreamModel: t.upstreamModel,
      channel: t.channel.name,
      ok: !error,
      latencyMs: Date.now() - startedAt,
      ttfbMs: ttfb,
      inTokens: usage?.input,
      outTokens: usage?.output,
      stream,
      attempts,
      error,
    }, ctx);
  };
}

/** 重放日志时由服务端直接调用：指定令牌上下文，跳过验令牌 */
export interface Invoke {
  token?: TokenCtx;
  replayOf?: string;
}

/** 验令牌 → 建请求上下文 → 包一层记录详情 */
async function entry(req: Request, inv: Invoke | undefined, source: Source, unauthorized: () => Response, run: (req: Request, ctx: ReqCtx) => Promise<Response>) {
  try {
    const token = inv?.token ?? (await authToken(req));
    if (!token) return cors(unauthorized());
    const ctx = newCtx(token, inv?.replayOf);
    return await captured(req, ctx, (r) => run(r, ctx));
  } catch (e) {
    if (isDbDown(e)) return cors(errorFor(source, e));
    throw e;
  }
}

/** 令牌限制没通过：记一条失败日志（方便在日志里看到原因），按对应接口格式返回 */
async function denied(source: LogEntry["source"], model: string, d: Deny, ctx: ReqCtx, stream: boolean, fmt: (d: Deny) => Response) {
  await addLog({ source, model, channel: "-", ok: false, latencyMs: 0, stream, attempts: 0, error: d.message }, ctx);
  return cors(fmt(d));
}

/** 同格式透传时，从流里顺手抓 token 用量 */
function usageFrom(source: Source, j: any): IUsage | undefined {
  if (source === "openai" && j?.usage) return { input: j.usage.prompt_tokens || 0, output: j.usage.completion_tokens || 0 };
  if (source === "claude") {
    if (j?.type === "message_start" && j.message?.usage) return { input: j.message.usage.input_tokens || 0, output: j.message.usage.output_tokens || 0 };
    if (j?.type === "message_delta" && j.usage) return { input: j.usage.input_tokens || 0, output: j.usage.output_tokens || 0 };
    if (j?.type === "message" && j.usage) return { input: j.usage.input_tokens || 0, output: j.usage.output_tokens || 0 };
  }
  if (source === "gemini" && j?.usageMetadata)
    return { input: j.usageMetadata.promptTokenCount || 0, output: (j.usageMetadata.candidatesTokenCount || 0) + (j.usageMetadata.thoughtsTokenCount || 0) };
  return undefined;
}

async function* rawSSE(
  res: Response,
  source: Source,
  done: (u?: IUsage, ttfb?: number, err?: string) => Promise<void>,
  startedAt: number,
  dropUsageOnly: boolean,
): AsyncGenerator<string> {
  let usage: IUsage | undefined;
  let ttfb: number | undefined;
  let err: string | undefined;
  try {
    for await (const ev of readSSE(res.body!)) {
      if (ttfb == null) ttfb = Date.now() - startedAt;
      let drop = false;
      if (ev.data !== "[DONE]") {
        try {
          const j = JSON.parse(ev.data);
          const u = usageFrom(source, j);
          if (u) usage = source === "claude" && usage ? { input: u.input || usage.input, output: u.output || usage.output } : u;
          if (dropUsageOnly && j.usage && Array.isArray(j.choices) && j.choices.length === 0) drop = true;
        } catch {
          /* 原样转发 */
        }
      }
      if (!drop) yield (ev.event ? `event: ${ev.event}\n` : "") + `data: ${ev.data}\n\n`;
    }
  } catch (e) {
    err = (e as Error)?.message || String(e);
    throw e;
  } finally {
    await done(usage, ttfb, err);
  }
}

async function rawJSON(res: Response, source: Source, done: (u?: IUsage) => Promise<void>) {
  const text = await res.text();
  let usage: IUsage | undefined;
  try {
    usage = usageFrom(source, JSON.parse(text));
  } catch {
    /* ignore */
  }
  await done(usage);
  return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
}

/**
 * 数据库不可用（Aiven 免费档被关机等）时按各家格式返回 503，带 Retry-After，客户端能看懂、会自动重试的也会重试。
 */
function dbDownError(source: Source, e: DbDownError) {
  const msg =
    e.kind === "config"
      ? `Prism 的数据库配置有问题，暂时无法服务：${e.message}`
      : e.kind === "busy"
        ? "Prism 的数据库连接数满了，请稍后重试（database busy）"
        : "Prism 的数据库睡着了（可能是 Aiven 免费档长时间没用被关机），请站长到 Aiven 控制台点 Power on 后重试（database unavailable）";
  const r = source === "claude" ? claudeError(503, msg) : source === "gemini" ? geminiError(503, msg) : openaiError(503, msg, "database_unavailable");
  r.headers.set("Retry-After", "30");
  return r;
}

function errorFor(source: Source, e: unknown) {
  if (isDbDown(e)) return dbDownError(source, e);
  const err = e as FailoverError;
  const status = err instanceof RelayError ? err.httpStatus : 500;
  const msg = err?.message || String(e);
  if (source === "claude") return claudeError(status, msg);
  if (source === "gemini") return geminiError(status, msg);
  return openaiError(status, msg);
}

async function readBody(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// ===================== /v1/chat/completions =====================
export function handleOpenAIChat(req: Request, inv?: Invoke): Promise<Response> {
  return entry(req, inv, "openai", () => openaiError(401, "令牌无效（Invalid API token）", "invalid_request_error"), openaiChat);
}

async function openaiChat(req: Request, ctx: ReqCtx): Promise<Response> {
  const body = await readBody(req);
  if (!body?.model) return cors(openaiError(400, "缺少 model 参数"));
  const stream = !!body.stream;
  const deny = await tokenDeny(ctx.token!, body.model);
  if (deny) return denied("openai", body.model, deny, ctx, stream, (d) => openaiError(d.status, d.message, d.type));
  const includeUsage = !!body.stream_options?.include_usage;
  const startedAt = Date.now();
  let internal: IChatRequest | null = null;
  try {
    const r = await withFailover<Attempt>(body.model, async (t) => {
      if (familyOf(t.channel.type) === "openai") {
        const up = { ...body, model: t.upstreamModel };
        if (stream) up.stream_options = { ...(body.stream_options || {}), include_usage: true };
        const res = await fetchUpstream(
          openaiUrl(t, "chat/completions"),
          { method: "POST", headers: openaiHeaders(t), body: JSON.stringify(up) },
          t.channel.timeoutMs,
          req.signal,
          t.channel.name,
        );
        return { raw: res };
      }
      internal ??= await inlineImages(fromOpenAI(body));
      return { events: await adapterChat(t, { ...internal, model: t.upstreamModel }, req.signal) };
    });
    const log = rawLogger("openai", body.model, r.target, r.attempts, r.startedAt, stream, ctx);
    if ("raw" in r.value) {
      const res = r.value.raw;
      if (stream && (res.headers.get("content-type") || "").includes("event-stream"))
        return cors(new Response(streamFrom(rawSSE(res, "openai", log, r.startedAt, !includeUsage)), { headers: SSE_HEADERS }));
      return cors(await rawJSON(res, "openai", log));
    }
    const events = withLogging(r.value.events, { source: "openai", model: body.model, target: r.target, attempts: r.attempts, startedAt: r.startedAt, stream, ctx });
    if (stream) return cors(new Response(streamFrom(openaiSSE(events, body.model, includeUsage)), { headers: SSE_HEADERS }));
    return cors(Response.json(openaiJSON(await collect(events), body.model)));
  } catch (e) {
    await logFailure("openai", body.model, e, startedAt, stream, ctx);
    return cors(errorFor("openai", e));
  }
}

// ===================== /v1/messages =====================
export function handleClaudeMessages(req: Request, inv?: Invoke): Promise<Response> {
  return entry(req, inv, "claude", () => claudeError(401, "令牌无效（Invalid API token）"), claudeMessages);
}

async function claudeMessages(req: Request, ctx: ReqCtx): Promise<Response> {
  const body = await readBody(req);
  if (!body?.model) return cors(claudeError(400, "缺少 model 参数"));
  const stream = !!body.stream;
  const deny = await tokenDeny(ctx.token!, body.model);
  if (deny) return denied("claude", body.model, deny, ctx, stream, (d) => claudeError(d.status, d.message));
  const startedAt = Date.now();
  let internal: IChatRequest | null = null;
  const passHeaders: Record<string, string> = { "anthropic-version": req.headers.get("anthropic-version") || ANTHROPIC_VERSION };
  const beta = req.headers.get("anthropic-beta");
  if (beta) passHeaders["anthropic-beta"] = beta;
  try {
    const r = await withFailover<Attempt>(body.model, async (t) => {
      if (familyOf(t.channel.type) === "claude") {
        const res = await fetchUpstream(
          `${t.base}/messages`,
          { method: "POST", headers: claudeHeaders(t, passHeaders), body: JSON.stringify({ ...body, model: t.upstreamModel }) },
          t.channel.timeoutMs,
          req.signal,
          t.channel.name,
        );
        return { raw: res };
      }
      internal ??= await inlineImages(fromClaude(body));
      return { events: await adapterChat(t, { ...internal, model: t.upstreamModel }, req.signal) };
    });
    const log = rawLogger("claude", body.model, r.target, r.attempts, r.startedAt, stream, ctx);
    if ("raw" in r.value) {
      const res = r.value.raw;
      if (stream && (res.headers.get("content-type") || "").includes("event-stream"))
        return cors(new Response(streamFrom(rawSSE(res, "claude", log, r.startedAt, false)), { headers: SSE_HEADERS }));
      return cors(await rawJSON(res, "claude", log));
    }
    const events = withLogging(r.value.events, { source: "claude", model: body.model, target: r.target, attempts: r.attempts, startedAt: r.startedAt, stream, ctx });
    if (stream) return cors(new Response(streamFrom(claudeSSE(events, body.model)), { headers: SSE_HEADERS }));
    return cors(Response.json(claudeJSON(await collect(events), body.model)));
  } catch (e) {
    await logFailure("claude", body.model, e, startedAt, stream, ctx);
    return cors(errorFor("claude", e));
  }
}

// ===================== /v1beta/models/{model}:{method} =====================
export function handleGemini(req: Request, model: string, method: string, inv?: Invoke): Promise<Response> {
  return entry(req, inv, "gemini", () => geminiError(401, "令牌无效（Invalid API key）"), (r, ctx) => gemini(r, model, method, ctx));
}

async function gemini(req: Request, model: string, method: string, ctx: ReqCtx): Promise<Response> {
  const isStream = method === "streamGenerateContent";
  if (method !== "generateContent" && !isStream && method !== "countTokens")
    return cors(geminiError(404, `不支持的方法：${method}`));
  const body = await readBody(req);
  if (!body) return cors(geminiError(400, "请求体不是合法 JSON"));
  const deny = await tokenDeny(ctx.token!, model);
  if (deny) return denied("gemini", model, deny, ctx, isStream, (d) => geminiError(d.status, d.message));
  const alt = new URL(req.url).searchParams.get("alt") === "sse";
  const startedAt = Date.now();
  let internal: IChatRequest | null = null;
  try {
    const r = await withFailover<Attempt>(model, async (t) => {
      if (familyOf(t.channel.type) === "gemini") {
        const res = await fetchUpstream(
          geminiUrl(t, t.upstreamModel, method, isStream && alt),
          { method: "POST", headers: geminiHeaders(t), body: JSON.stringify(body) },
          t.channel.timeoutMs,
          req.signal,
          t.channel.name,
        );
        return { raw: res };
      }
      if (method === "countTokens") throw new RelayError("unsupported", "只有 Gemini 渠道支持 countTokens", 400, t.channel.name);
      internal ??= await inlineImages(fromGemini(body, model));
      return { events: await adapterChat(t, { ...internal, model: t.upstreamModel, stream: isStream }, req.signal) };
    });
    const log = rawLogger("gemini", model, r.target, r.attempts, r.startedAt, isStream, ctx);
    if ("raw" in r.value) {
      const res = r.value.raw;
      if (isStream && alt) return cors(new Response(streamFrom(rawSSE(res, "gemini", log, r.startedAt, false)), { headers: SSE_HEADERS }));
      if (isStream) {
        void log();
        return cors(new Response(res.body, { headers: { "Content-Type": "application/json" } }));
      }
      return cors(await rawJSON(res, "gemini", log));
    }
    const events = withLogging(r.value.events, { source: "gemini", model, target: r.target, attempts: r.attempts, startedAt: r.startedAt, stream: isStream, ctx });
    if (isStream)
      return cors(
        new Response(streamFrom(geminiStream(events, model, alt)), {
          headers: alt ? SSE_HEADERS : { "Content-Type": "application/json" },
        }),
      );
    return cors(Response.json(geminiJSON(await collect(events), model)));
  } catch (e) {
    await logFailure("gemini", model, e, startedAt, isStream, ctx);
    return cors(errorFor("gemini", e));
  }
}

// ===================== /v1/images/generations =====================
export function handleImages(req: Request, inv?: Invoke): Promise<Response> {
  return entry(req, inv, "openai", () => openaiError(401, "令牌无效（Invalid API token）", "invalid_request_error"), images);
}

async function images(req: Request, ctx: ReqCtx): Promise<Response> {
  const body = await readBody(req);
  if (!body?.model || !body?.prompt) return cors(openaiError(400, "缺少 model 或 prompt 参数"));
  const deny = await tokenDeny(ctx.token!, body.model);
  if (deny) return denied("image", body.model, deny, ctx, false, (d) => openaiError(d.status, d.message, d.type));
  const startedAt = Date.now();
  try {
    const r = await withFailover(body.model, async (t) => {
      if (familyOf(t.channel.type) === "openai") {
        const res = await fetchUpstream(
          openaiUrl(t, "images/generations"),
          { method: "POST", headers: openaiHeaders(t), body: JSON.stringify({ ...body, model: t.upstreamModel }) },
          Math.max(t.channel.timeoutMs, 240000),
          req.signal,
          t.channel.name,
        );
        return { raw: await res.text() };
      }
      const imgs = await adapterImage(
        t,
        { model: t.upstreamModel, prompt: body.prompt, n: Math.min(4, Number(body.n) || 1), size: body.size, quality: body.quality },
        req.signal,
      );
      return { imgs };
    });
    await addLog({
      source: "image",
      model: body.model,
      upstreamModel: r.target.upstreamModel,
      channel: r.target.channel.name,
      ok: true,
      latencyMs: Date.now() - startedAt,
      attempts: r.attempts,
    }, ctx);
    const origin = publicOrigin(req);
    if (typeof r.value.raw === "string") return cors(await localizeOpenAIImages(r.value.raw, body.response_format, origin));
    const data = await Promise.all((r.value.imgs || []).map((im) => toImageItem(im, body.response_format, origin)));
    return cors(Response.json({ created: Math.floor(Date.now() / 1000), data }));
  } catch (e) {
    await logFailure("image", body.model, e, startedAt, false, ctx);
    return cors(errorFor("openai", e));
  }
}

/**
 * 生图结果里的每一张图：
 * - 客户端要 b64_json：给 base64（上游给的是链接就由服务端下载后转成 base64）
 * - 其他情况给 url：一律是本站地址（上游的临时链接先下载转存），浏览器和客户端都不用直连上游
 */
async function toImageItem(
  im: { b64?: string; mime?: string; url?: string },
  format: unknown,
  origin: string,
): Promise<Record<string, string>> {
  if (format === "b64_json") {
    if (im.b64) return { b64_json: im.b64 };
    if (im.url) {
      try {
        return { b64_json: (await resolveImage(im.url)).data };
      } catch {
        return { url: absoluteImageUrl(await persistRemoteImage(im.url), origin) };
      }
    }
    return {};
  }
  if (im.b64) {
    // 没指定格式时保持上游原样（比如 gpt-image 默认就回 base64）
    if (format !== "url") return { b64_json: im.b64 };
    return { url: absoluteImageUrl(await saveFile(Buffer.from(im.b64, "base64"), im.mime || "image/png"), origin) };
  }
  if (im.url) return { url: absoluteImageUrl(await persistRemoteImage(im.url), origin) };
  return {};
}

/** OpenAI 系渠道的生图响应原样转发，但 data[].url 换成本站地址；其他字段（revised_prompt、usage 等）保持不变 */
async function localizeOpenAIImages(raw: string, format: unknown, origin: string): Promise<Response> {
  let j: { data?: Array<Record<string, unknown>> } | null = null;
  try {
    j = JSON.parse(raw);
  } catch {}
  if (!j || !Array.isArray(j.data)) return new Response(raw, { headers: { "Content-Type": "application/json" } });
  j.data = await Promise.all(
    j.data.map(async (item) => {
      const { url, b64_json, ...rest } = item as { url?: unknown; b64_json?: unknown };
      const im = { b64: typeof b64_json === "string" ? b64_json : undefined, url: typeof url === "string" ? url : undefined };
      if (!im.b64 && !im.url) return item;
      return { ...rest, ...(await toImageItem(im, format, origin)) };
    }),
  );
  return Response.json(j);
}

// ===================== /v1/models =====================
export async function handleModels(req: Request, gemini = false): Promise<Response> {
  try {
    return await listModels(req, gemini);
  } catch (e) {
    if (isDbDown(e)) return cors(errorFor(gemini ? "gemini" : "openai", e));
    throw e;
  }
}

async function listModels(req: Request, gemini: boolean): Promise<Response> {
  const token = await authToken(req);
  if (!token) return cors(gemini ? geminiError(401, "令牌无效") : openaiError(401, "令牌无效（Invalid API token）"));
  const groups = buildCatalog(await listChannels(), false);
  const seen = new Map<string, string>();
  // 限定了模型的令牌只列出它能用的模型
  for (const g of groups) for (const m of g.models) if (!seen.has(m.id) && modelAllowed(token.rec, m.id)) seen.set(m.id, g.channelName);
  if (gemini)
    return cors(
      Response.json({
        models: [...seen.keys()].map((id) => ({
          name: `models/${id}`,
          displayName: id,
          supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
        })),
      }),
    );
  const created = Math.floor(Date.now() / 1000);
  return cors(
    Response.json({
      object: "list",
      data: [...seen.entries()].map(([id, owner]) => ({ id, object: "model", created, owned_by: owner, type: "model", display_name: id })),
      has_more: false,
    }),
  );
}
