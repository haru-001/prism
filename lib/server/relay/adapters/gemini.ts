import "server-only";
import type { IChatEvent, IChatRequest, IImageRequest, IImageResult, IMessage } from "../../../types";
import { fetchUpstream, RelayError } from "../errors";
import { readSSE } from "../sse";
import type { Target } from "../target";

export function geminiHeaders(t: Target): Record<string, string> {
  return { "Content-Type": "application/json", "x-goog-api-key": t.key };
}

export function geminiUrl(t: Target, model: string, method: string, sse = false) {
  const m = model.replace(/^models\//, "");
  return `${t.base}/models/${encodeURIComponent(m)}:${method}${sse ? "?alt=sse" : ""}`;
}

function toContents(msgs: IMessage[]) {
  const out: { role: string; parts: unknown[] }[] = [];
  for (const m of msgs) {
    const role = m.role === "assistant" ? "model" : "user";
    const parts = m.content
      .filter((p) => p.type !== "text" || p.text !== "")
      .map((p) =>
        p.type === "text"
          ? { text: p.text }
          : p.data
            ? { inlineData: { mimeType: p.mime || "image/png", data: p.data } }
            : { fileData: { mimeType: p.mime || "image/png", fileUri: p.url } },
      );
    if (!parts.length) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  }
  return out;
}

export function geminiBody(req: IChatRequest) {
  const body: Record<string, unknown> = { contents: toContents(req.messages) };
  if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
  const gc: Record<string, unknown> = {};
  if (req.temperature != null) gc.temperature = req.temperature;
  if (req.topP != null) gc.topP = req.topP;
  if (req.maxTokens) gc.maxOutputTokens = req.maxTokens;
  if (req.stop?.length) gc.stopSequences = req.stop;
  if (Object.keys(gc).length) body.generationConfig = gc;
  return body;
}

export async function geminiChat(t: Target, req: IChatRequest, signal?: AbortSignal): Promise<AsyncGenerator<IChatEvent>> {
  const res = await fetchUpstream(
    geminiUrl(t, t.upstreamModel, "streamGenerateContent", true),
    { method: "POST", headers: geminiHeaders(t), body: JSON.stringify(geminiBody(req)) },
    t.channel.timeoutMs,
    signal,
    t.channel.name,
  );
  return parseGeminiResponse(res);
}

export function mapGeminiFinish(r?: string) {
  if (!r) return "stop";
  if (r === "MAX_TOKENS") return "length";
  return "stop";
}

function* eventsFromChunk(j: Record<string, any>, state: { finish?: string; usage?: { input: number; output: number } }) {
  if (j.error) throw new RelayError("http", j.error.message || "上游返回错误", j.error.code || 500);
  const cand = j.candidates?.[0];
  for (const p of cand?.content?.parts || []) {
    if (typeof p.text === "string" && p.text) yield p.thought ? { type: "reasoning" as const, text: p.text } : { type: "text" as const, text: p.text };
  }
  if (cand?.finishReason) state.finish = cand.finishReason;
  if (j.usageMetadata) {
    state.usage = {
      input: j.usageMetadata.promptTokenCount || 0,
      output: (j.usageMetadata.candidatesTokenCount || 0) + (j.usageMetadata.thoughtsTokenCount || 0),
    };
  }
  if (j.promptFeedback?.blockReason && !cand) throw new RelayError("http", `内容被拦截：${j.promptFeedback.blockReason}`, 400);
}

export async function* parseGeminiResponse(res: Response): AsyncGenerator<IChatEvent> {
  const ct = res.headers.get("content-type") || "";
  const state: { finish?: string; usage?: { input: number; output: number } } = {};
  if (ct.includes("application/json")) {
    const j = await res.json();
    for (const chunk of Array.isArray(j) ? j : [j]) yield* eventsFromChunk(chunk, state);
  } else if (res.body) {
    yield* parseGeminiSSEInner(res.body, state);
  }
  if (state.usage) yield { type: "usage", usage: state.usage };
  yield { type: "finish", reason: mapGeminiFinish(state.finish) };
}

async function* parseGeminiSSEInner(body: ReadableStream<Uint8Array>, state: { finish?: string; usage?: { input: number; output: number } }) {
  for await (const ev of readSSE(body)) {
    let j: Record<string, any>;
    try {
      j = JSON.parse(ev.data);
    } catch {
      continue;
    }
    yield* eventsFromChunk(j, state);
  }
}

export async function* parseGeminiSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<IChatEvent> {
  const state: { finish?: string; usage?: { input: number; output: number } } = {};
  yield* parseGeminiSSEInner(body, state);
  if (state.usage) yield { type: "usage", usage: state.usage };
  yield { type: "finish", reason: mapGeminiFinish(state.finish) };
}

export async function geminiListModels(t: Target): Promise<string[]> {
  const out: string[] = [];
  let token = "";
  for (let i = 0; i < 5; i++) {
    const url = `${t.base}/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`;
    const res = await fetchUpstream(url, { headers: geminiHeaders(t) }, 20000, undefined, t.channel.name);
    const j = await res.json();
    for (const m of (j.models || []) as { name: string; supportedGenerationMethods?: string[] }[]) {
      const methods = m.supportedGenerationMethods || [];
      if (methods.length && !methods.includes("generateContent")) continue;
      out.push(m.name.replace(/^models\//, ""));
    }
    if (!j.nextPageToken) break;
    token = j.nextPageToken;
  }
  return out;
}

function aspectOf(size?: string) {
  if (!size || size === "auto") return undefined;
  const [w, h] = size.split("x").map(Number);
  if (!w || !h) return undefined;
  if (w === h) return "1:1";
  return w > h ? "3:2" : "2:3";
}

export async function geminiImage(t: Target, req: IImageRequest, signal?: AbortSignal): Promise<IImageResult[]> {
  const parts: unknown[] = [{ text: req.prompt }];
  for (const r of req.refs || []) parts.push({ inlineData: { mimeType: r.mime, data: r.data } });
  const gc: Record<string, unknown> = { responseModalities: ["TEXT", "IMAGE"] };
  const aspect = aspectOf(req.size);
  if (aspect) gc.imageConfig = { aspectRatio: aspect };
  const body = JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: gc });
  const one = async (): Promise<IImageResult[]> => {
    const res = await fetchUpstream(
      geminiUrl(t, t.upstreamModel, "generateContent"),
      { method: "POST", headers: geminiHeaders(t), body },
      Math.max(t.channel.timeoutMs, 240000),
      signal,
      t.channel.name,
    );
    const j = await res.json();
    const imgs: IImageResult[] = [];
    let text = "";
    for (const p of j.candidates?.[0]?.content?.parts || []) {
      const d = p.inlineData || p.inline_data;
      if (d?.data) imgs.push({ b64: d.data, mime: d.mimeType || d.mime_type || "image/png" });
      else if (p.text) text += p.text;
    }
    if (!imgs.length) throw new RelayError("http", text ? `模型没有出图，只回了文字：${text.slice(0, 200)}` : "上游没有返回图片", 502);
    return imgs;
  };
  return (await Promise.all(Array.from({ length: Math.max(1, req.n) }, one))).flat();
}
