import "server-only";
import type { IChatEvent, IChatRequest, IImageRequest, IImageResult, IMessage } from "../../../types";
import { fetchUpstream, RelayError } from "../errors";
import { readSSE } from "../sse";
import type { Target } from "../target";

// ===== URL / 请求头 =====
export function openaiUrl(t: Target, path: string, model?: string): string {
  const ch = t.channel;
  if (ch.type === "azure") {
    const ver = ch.apiVersion || "2024-10-21";
    if (ver === "v1") return `${t.base}/openai/v1/${path}`;
    if (path === "models") return `${t.base}/openai/models?api-version=${ver}`;
    return `${t.base}/openai/deployments/${encodeURIComponent(model || t.upstreamModel)}/${path}?api-version=${ver}`;
  }
  return `${t.base}/${path}`;
}

export function openaiHeaders(t: Target, json = true): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (t.channel.type === "azure") h["api-key"] = t.key;
  else h["Authorization"] = `Bearer ${t.key}`;
  return h;
}

/** o 系列 / gpt-5 这类推理模型不接受 temperature，要用 max_completion_tokens */
export function isReasoningModel(model: string) {
  const m = model.toLowerCase();
  return /^(o\d|gpt-5)/.test(m) && !/gpt-5.*chat/.test(m);
}

function toOpenAIMessages(req: IChatRequest) {
  const out: unknown[] = [];
  if (req.system) out.push({ role: "system", content: req.system });
  for (const m of req.messages) out.push({ role: m.role, content: partsToOpenAI(m) });
  return out;
}

function partsToOpenAI(m: IMessage) {
  const hasImage = m.content.some((p) => p.type === "image");
  if (!hasImage) return m.content.map((p) => (p.type === "text" ? p.text : "")).join("");
  return m.content.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : { type: "image_url", image_url: { url: p.data ? `data:${p.mime || "image/png"};base64,${p.data}` : p.url } },
  );
}

export function openaiChatBody(req: IChatRequest, model: string) {
  const body: Record<string, unknown> = {
    model,
    messages: toOpenAIMessages(req),
    stream: true,
    stream_options: { include_usage: true },
  };
  const reasoning = isReasoningModel(model);
  if (!reasoning) {
    if (req.temperature != null) body.temperature = req.temperature;
    if (req.topP != null) body.top_p = req.topP;
    if (req.maxTokens) body.max_tokens = req.maxTokens;
  } else if (req.maxTokens) body.max_completion_tokens = req.maxTokens;
  if (req.stop?.length) body.stop = req.stop;
  return body;
}

// ===== 对话 =====
export async function openaiChat(t: Target, req: IChatRequest, signal?: AbortSignal): Promise<AsyncGenerator<IChatEvent>> {
  const res = await fetchUpstream(
    openaiUrl(t, "chat/completions"),
    { method: "POST", headers: openaiHeaders(t), body: JSON.stringify(openaiChatBody(req, t.upstreamModel)) },
    t.channel.timeoutMs,
    signal,
    t.channel.name,
  );
  return parseOpenAIResponse(res);
}

export function mapOpenAIFinish(r?: string | null) {
  if (!r) return "stop";
  if (r === "length") return "length";
  return r === "stop" ? "stop" : r;
}

/** 解析 OpenAI 格式的流（也兼容上游忽略 stream 直接返回 JSON 的情况） */
export async function* parseOpenAIResponse(res: Response): AsyncGenerator<IChatEvent> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await res.json();
    if (j.error) throw new RelayError("http", j.error.message || JSON.stringify(j.error), 500);
    const msg = j.choices?.[0]?.message || {};
    const reasoning = msg.reasoning_content || msg.reasoning;
    if (reasoning) yield { type: "reasoning", text: reasoning };
    if (msg.content) yield { type: "text", text: msg.content };
    if (j.usage) yield { type: "usage", usage: { input: j.usage.prompt_tokens || 0, output: j.usage.completion_tokens || 0 } };
    yield { type: "finish", reason: mapOpenAIFinish(j.choices?.[0]?.finish_reason) };
    return;
  }
  if (!res.body) return;
  yield* parseOpenAISSE(res.body);
}

export async function* parseOpenAISSE(body: ReadableStream<Uint8Array>): AsyncGenerator<IChatEvent> {
  let finished = false;
  for await (const ev of readSSE(body)) {
    if (ev.data === "[DONE]") break;
    let j: Record<string, any>;
    try {
      j = JSON.parse(ev.data);
    } catch {
      continue;
    }
    if (j.error) throw new RelayError("http", j.error.message || JSON.stringify(j.error), 500);
    const c = j.choices?.[0];
    const d = c?.delta || {};
    const reasoning = d.reasoning_content ?? d.reasoning;
    if (typeof reasoning === "string" && reasoning) yield { type: "reasoning", text: reasoning };
    if (typeof d.content === "string" && d.content) yield { type: "text", text: d.content };
    if (j.usage && (j.usage.prompt_tokens != null || j.usage.completion_tokens != null))
      yield { type: "usage", usage: { input: j.usage.prompt_tokens || 0, output: j.usage.completion_tokens || 0 } };
    if (c?.finish_reason && !finished) {
      finished = true;
      yield { type: "finish", reason: mapOpenAIFinish(c.finish_reason) };
    }
  }
  if (!finished) yield { type: "finish", reason: "stop" };
}

// ===== 模型列表 =====
export async function openaiListModels(t: Target): Promise<string[]> {
  if (t.channel.type === "azure" && t.channel.apiVersion !== "v1") {
    // 数据面的「部署列表」接口只在老版本里有，取不到就退回基础模型列表
    try {
      const res = await fetchUpstream(
        `${t.base}/openai/deployments?api-version=2022-12-01`,
        { headers: openaiHeaders(t, false) },
        20000,
      );
      const j = await res.json();
      const ids = (j.data || []).map((d: { id: string }) => d.id).filter(Boolean);
      if (ids.length) return ids;
    } catch {
      /* 退回下面 */
    }
  }
  const res = await fetchUpstream(openaiUrl(t, "models"), { headers: openaiHeaders(t, false) }, 20000, undefined, t.channel.name);
  const j = await res.json();
  const list = Array.isArray(j) ? j : j.data || j.models || [];
  return list.map((m: { id?: string; name?: string } | string) => (typeof m === "string" ? m : m.id || m.name || "")).filter(Boolean);
}

// ===== 生图 =====
function openaiImageParams(req: IImageRequest, model: string) {
  const m = model.toLowerCase();
  const isDalle3 = m.includes("dall-e-3");
  const isDalle = m.includes("dall-e");
  const isGptImage = m.includes("gpt-image");
  let size = req.size && req.size !== "auto" ? req.size : undefined;
  if (isDalle3 && size) size = size === "1024x1536" ? "1024x1792" : size === "1536x1024" ? "1792x1024" : size;
  if (req.size === "auto" && isGptImage) size = "auto";
  let quality: string | undefined;
  if (req.quality) {
    if (isDalle3) quality = req.quality === "high" ? "hd" : "standard";
    else if (isGptImage) quality = req.quality;
  }
  return { size, quality, isDalle, isDalle3 };
}

async function readImageResponse(res: Response): Promise<IImageResult[]> {
  const j = await res.json();
  const data = (j.data || []) as { b64_json?: string; url?: string; revised_prompt?: string }[];
  if (!data.length) throw new RelayError("http", "上游没有返回图片", 502);
  return data.map((d) => ({ b64: d.b64_json, url: d.url, mime: "image/png", revisedPrompt: d.revised_prompt }));
}

export async function openaiImage(t: Target, req: IImageRequest, signal?: AbortSignal): Promise<IImageResult[]> {
  const { size, quality, isDalle, isDalle3 } = openaiImageParams(req, t.upstreamModel);
  const timeout = Math.max(t.channel.timeoutMs, 240000);
  const one = async (n: number): Promise<IImageResult[]> => {
    if (req.refs?.length) {
      const fd = new FormData();
      fd.append("model", t.upstreamModel);
      fd.append("prompt", req.prompt);
      fd.append("n", String(n));
      if (size) fd.append("size", size);
      if (quality && !isDalle) fd.append("quality", quality);
      const field = req.refs.length > 1 ? "image[]" : "image";
      req.refs.forEach((r, i) => {
        const ext = r.mime.split("/")[1] || "png";
        fd.append(field, new Blob([Buffer.from(r.data, "base64")], { type: r.mime }), `ref${i}.${ext}`);
      });
      if (isDalle) fd.append("response_format", "b64_json");
      const res = await fetchUpstream(
        openaiUrl(t, "images/edits"),
        { method: "POST", headers: openaiHeaders(t, false), body: fd },
        timeout,
        signal,
        t.channel.name,
      );
      return readImageResponse(res);
    }
    const body: Record<string, unknown> = { model: t.upstreamModel, prompt: req.prompt, n };
    if (size) body.size = size;
    if (quality) body.quality = quality;
    if (isDalle) body.response_format = "b64_json";
    const res = await fetchUpstream(
      openaiUrl(t, "images/generations"),
      { method: "POST", headers: openaiHeaders(t), body: JSON.stringify(body) },
      timeout,
      signal,
      t.channel.name,
    );
    return readImageResponse(res);
  };
  // dall-e-3 一次只能出 1 张，并发多发几次
  if (isDalle3 && req.n > 1) return (await Promise.all(Array.from({ length: req.n }, () => one(1)))).flat();
  return one(req.n);
}
