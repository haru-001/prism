import "server-only";
import type { IChatEvent, IChatRequest, IMessage, IPart, IUsage } from "../../types";
import { randomId } from "../crypto";
import { RelayError } from "./errors";
import { sseLine } from "./sse";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ================= 通用 =================
export interface Collected {
  text: string;
  reasoning: string;
  usage: IUsage;
  finish: string;
}

export async function collect(events: AsyncGenerator<IChatEvent>): Promise<Collected> {
  const out: Collected = { text: "", reasoning: "", usage: { input: 0, output: 0 }, finish: "stop" };
  for await (const ev of events) {
    if (ev.type === "text") out.text += ev.text;
    else if (ev.type === "reasoning") out.reasoning += ev.text;
    else if (ev.type === "usage") out.usage = ev.usage;
    else if (ev.type === "finish") out.finish = ev.reason;
  }
  return out;
}

function dataUrlPart(url: string): IPart {
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(url);
  if (m) return { type: "image", data: m[2], mime: m[1] };
  return { type: "image", url };
}

function textOfOpenAI(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((p: any) => (typeof p === "string" ? p : p?.text ?? ""))
      .filter(Boolean)
      .join("\n");
  return content == null ? "" : String(content);
}

const errMsg = (e: unknown) => (e as Error)?.message || String(e);

// ================= OpenAI =================
export function fromOpenAI(body: any): IChatRequest {
  if (!Array.isArray(body?.messages)) throw new RelayError("bad", "messages 必须是数组", 400);
  const sys: string[] = [];
  const messages: IMessage[] = [];
  for (const m of body.messages) {
    if (m.role === "system" || m.role === "developer") {
      sys.push(textOfOpenAI(m.content));
      continue;
    }
    if (m.role === "tool" || m.role === "function") {
      messages.push({ role: "user", content: [{ type: "text", text: `[工具结果] ${textOfOpenAI(m.content)}` }] });
      continue;
    }
    const role = m.role === "assistant" ? "assistant" : "user";
    const parts: IPart[] = [];
    if (typeof m.content === "string") parts.push({ type: "text", text: m.content });
    else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p?.type === "text" || p?.type === "input_text") parts.push({ type: "text", text: p.text || "" });
        else if (p?.type === "image_url") {
          const url = typeof p.image_url === "string" ? p.image_url : p.image_url?.url;
          if (url) parts.push(dataUrlPart(url));
        }
      }
    }
    if (role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length)
      parts.push({ type: "text", text: `[调用工具] ${JSON.stringify(m.tool_calls.map((c: any) => c.function))}` });
    if (parts.length) messages.push({ role, content: parts });
  }
  return {
    model: body.model,
    system: sys.filter(Boolean).join("\n\n") || undefined,
    messages,
    temperature: body.temperature ?? undefined,
    topP: body.top_p ?? undefined,
    maxTokens: body.max_completion_tokens ?? body.max_tokens ?? undefined,
    stop: body.stop ? (Array.isArray(body.stop) ? body.stop : [body.stop]) : undefined,
    stream: !!body.stream,
  };
}

const oaFinish = (r: string) => (r === "length" ? "length" : "stop");

export async function* openaiSSE(events: AsyncGenerator<IChatEvent>, model: string, includeUsage: boolean): AsyncGenerator<string> {
  const id = "chatcmpl-" + randomId(24);
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    sseLine({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] });
  yield chunk({ role: "assistant", content: "" });
  let usage: IUsage | undefined;
  let finish = "stop";
  try {
    for await (const ev of events) {
      if (ev.type === "text") yield chunk({ content: ev.text });
      else if (ev.type === "reasoning") yield chunk({ reasoning_content: ev.text });
      else if (ev.type === "usage") usage = ev.usage;
      else if (ev.type === "finish") finish = ev.reason;
    }
  } catch (e) {
    yield sseLine({ error: { message: errMsg(e), type: "upstream_error" } });
    yield "data: [DONE]\n\n";
    return;
  }
  yield chunk({}, oaFinish(finish));
  if (includeUsage && usage)
    yield sseLine({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [],
      usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output },
    });
  yield "data: [DONE]\n\n";
}

export function openaiJSON(c: Collected, model: string) {
  const message: Record<string, unknown> = { role: "assistant", content: c.text };
  if (c.reasoning) message.reasoning_content = c.reasoning;
  return {
    id: "chatcmpl-" + randomId(24),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: oaFinish(c.finish) }],
    usage: { prompt_tokens: c.usage.input, completion_tokens: c.usage.output, total_tokens: c.usage.input + c.usage.output },
  };
}

export function openaiError(status: number, message: string, type = "prism_error") {
  return Response.json({ error: { message, type, code: status } }, { status });
}

// ================= Claude =================
export function fromClaude(body: any): IChatRequest {
  if (!Array.isArray(body?.messages)) throw new RelayError("bad", "messages 必须是数组", 400);
  const system = typeof body.system === "string" ? body.system : Array.isArray(body.system) ? body.system.map((b: any) => b.text || "").join("\n") : undefined;
  const messages: IMessage[] = [];
  for (const m of body.messages) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const parts: IPart[] = [];
    if (typeof m.content === "string") parts.push({ type: "text", text: m.content });
    else if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b.type === "text") parts.push({ type: "text", text: b.text || "" });
        else if (b.type === "image") {
          if (b.source?.type === "base64") parts.push({ type: "image", data: b.source.data, mime: b.source.media_type });
          else if (b.source?.url) parts.push({ type: "image", url: b.source.url });
        } else if (b.type === "tool_use") parts.push({ type: "text", text: `[调用工具 ${b.name}] ${JSON.stringify(b.input)}` });
        else if (b.type === "tool_result") {
          const t = typeof b.content === "string" ? b.content : (b.content || []).map((x: any) => x.text || "").join("\n");
          parts.push({ type: "text", text: `[工具结果] ${t}` });
        }
      }
    }
    if (parts.length) messages.push({ role, content: parts });
  }
  return {
    model: body.model,
    system: system || undefined,
    messages,
    temperature: body.temperature ?? undefined,
    topP: body.top_p ?? undefined,
    maxTokens: body.max_tokens ?? undefined,
    stop: body.stop_sequences,
    stream: !!body.stream,
  };
}

const clStop = (r: string) => (r === "length" ? "max_tokens" : "end_turn");

export async function* claudeSSE(events: AsyncGenerator<IChatEvent>, model: string): AsyncGenerator<string> {
  const id = "msg_" + randomId(24);
  yield sseLine(
    {
      type: "message_start",
      message: { id, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
    },
    "message_start",
  );
  yield sseLine({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, "content_block_start");
  yield sseLine({ type: "ping" }, "ping");
  let usage: IUsage = { input: 0, output: 0 };
  let finish = "stop";
  try {
    for await (const ev of events) {
      if (ev.type === "text")
        yield sseLine({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: ev.text } }, "content_block_delta");
      else if (ev.type === "usage") usage = ev.usage;
      else if (ev.type === "finish") finish = ev.reason;
    }
  } catch (e) {
    yield sseLine({ type: "error", error: { type: "api_error", message: errMsg(e) } }, "error");
    return;
  }
  yield sseLine({ type: "content_block_stop", index: 0 }, "content_block_stop");
  yield sseLine(
    {
      type: "message_delta",
      delta: { stop_reason: clStop(finish), stop_sequence: null },
      usage: { input_tokens: usage.input, output_tokens: usage.output },
    },
    "message_delta",
  );
  yield sseLine({ type: "message_stop" }, "message_stop");
}

export function claudeJSON(c: Collected, model: string) {
  return {
    id: "msg_" + randomId(24),
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: c.text }],
    stop_reason: clStop(c.finish),
    stop_sequence: null,
    usage: { input_tokens: c.usage.input, output_tokens: c.usage.output },
  };
}

export function claudeError(status: number, message: string) {
  const type =
    status === 401 ? "authentication_error" : status === 403 ? "permission_error" : status === 404 ? "not_found_error" : status === 429 ? "rate_limit_error" : status === 400 ? "invalid_request_error" : "api_error";
  return Response.json({ type: "error", error: { type, message } }, { status });
}

// ================= Gemini =================
export function fromGemini(body: any, model: string): IChatRequest {
  if (!Array.isArray(body?.contents)) throw new RelayError("bad", "contents 必须是数组", 400);
  const sysParts = body.systemInstruction?.parts || body.system_instruction?.parts || [];
  const system = sysParts.map((p: any) => p.text || "").join("\n");
  const messages: IMessage[] = [];
  for (const c of body.contents) {
    const role = c.role === "model" ? "assistant" : "user";
    const parts: IPart[] = [];
    for (const p of c.parts || []) {
      if (typeof p.text === "string" && !p.thought) parts.push({ type: "text", text: p.text });
      const d = p.inlineData || p.inline_data;
      if (d?.data) parts.push({ type: "image", data: d.data, mime: d.mimeType || d.mime_type });
      const f = p.fileData || p.file_data;
      if (f?.fileUri || f?.file_uri) parts.push({ type: "image", url: f.fileUri || f.file_uri, mime: f.mimeType || f.mime_type });
      if (p.functionCall) parts.push({ type: "text", text: `[调用工具] ${JSON.stringify(p.functionCall)}` });
      if (p.functionResponse) parts.push({ type: "text", text: `[工具结果] ${JSON.stringify(p.functionResponse)}` });
    }
    if (parts.length) messages.push({ role, content: parts });
  }
  const gc = body.generationConfig || body.generation_config || {};
  return {
    model,
    system: system || undefined,
    messages,
    temperature: gc.temperature ?? undefined,
    topP: gc.topP ?? gc.top_p ?? undefined,
    maxTokens: gc.maxOutputTokens ?? gc.max_output_tokens ?? undefined,
    stop: gc.stopSequences ?? gc.stop_sequences,
    stream: false,
  };
}

const gmFinish = (r: string) => (r === "length" ? "MAX_TOKENS" : "STOP");

function gmChunk(model: string, parts: unknown[], extra: Record<string, unknown> = {}, finish?: string) {
  return {
    candidates: [{ content: { role: "model", parts }, index: 0, ...(finish ? { finishReason: finish } : {}) }],
    modelVersion: model,
    ...extra,
  };
}

function gmUsage(u: IUsage) {
  return { usageMetadata: { promptTokenCount: u.input, candidatesTokenCount: u.output, totalTokenCount: u.input + u.output } };
}

/** alt=sse 时输出 SSE，否则输出一个逐步写出的 JSON 数组（和官方行为一致） */
export async function* geminiStream(events: AsyncGenerator<IChatEvent>, model: string, sse: boolean): AsyncGenerator<string> {
  let first = true;
  const emit = (obj: unknown) => {
    if (sse) return sseLine(obj);
    const s = (first ? "[" : ",\r\n") + JSON.stringify(obj);
    first = false;
    return s;
  };
  let usage: IUsage = { input: 0, output: 0 };
  let finish = "stop";
  try {
    for await (const ev of events) {
      if (ev.type === "text") yield emit(gmChunk(model, [{ text: ev.text }]));
      else if (ev.type === "reasoning") yield emit(gmChunk(model, [{ text: ev.text, thought: true }]));
      else if (ev.type === "usage") usage = ev.usage;
      else if (ev.type === "finish") finish = ev.reason;
    }
  } catch (e) {
    yield emit({ error: { code: 500, message: errMsg(e), status: "INTERNAL" } });
    if (!sse) yield "]";
    return;
  }
  yield emit(gmChunk(model, [{ text: "" }], gmUsage(usage), gmFinish(finish)));
  if (!sse) yield "]";
}

export function geminiJSON(c: Collected, model: string) {
  const parts: unknown[] = [];
  if (c.reasoning) parts.push({ text: c.reasoning, thought: true });
  parts.push({ text: c.text });
  return gmChunk(model, parts, gmUsage(c.usage), gmFinish(c.finish));
}

export function geminiError(status: number, message: string) {
  const st =
    status === 401 || status === 403 ? "PERMISSION_DENIED" : status === 404 ? "NOT_FOUND" : status === 429 ? "RESOURCE_EXHAUSTED" : status === 400 ? "INVALID_ARGUMENT" : "INTERNAL";
  return Response.json({ error: { code: status, message, status: st } }, { status });
}
