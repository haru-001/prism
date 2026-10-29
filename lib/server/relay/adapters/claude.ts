import "server-only";
import type { IChatEvent, IChatRequest, IMessage } from "../../../types";
import { fetchUpstream, RelayError } from "../errors";
import { readSSE } from "../sse";
import type { Target } from "../target";

export const ANTHROPIC_VERSION = "2023-06-01";

export function claudeHeaders(t: Target, extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": t.key,
    "anthropic-version": ANTHROPIC_VERSION,
    ...extra,
  };
  // 非官方中转很多只认 Authorization，一起带上
  if (!/anthropic\.com/i.test(t.base)) h["Authorization"] = `Bearer ${t.key}`;
  return h;
}

function defaultMaxTokens(model: string) {
  const m = model.toLowerCase();
  if (/claude-3-(opus|sonnet|haiku)-2024|claude-3-haiku|claude-instant|claude-2/.test(m)) return 4096;
  return 8192;
}

/** Claude 要求 user/assistant 严格交替且以 user 开头，这里合并相邻同角色 */
function mergeRoles(msgs: IMessage[]): IMessage[] {
  const out: IMessage[] = [];
  for (const m of msgs) {
    if (!m.content.length) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content = [...last.content, { type: "text", text: "\n" }, ...m.content];
    else out.push({ role: m.role, content: [...m.content] });
  }
  if (out[0]?.role === "assistant") out.unshift({ role: "user", content: [{ type: "text", text: "（继续）" }] });
  return out;
}

export function claudeBody(req: IChatRequest, model: string) {
  const messages = mergeRoles(req.messages).map((m) => ({
    role: m.role,
    content: m.content
      .filter((p) => p.type !== "text" || p.text !== "")
      .map((p) =>
        p.type === "text"
          ? { type: "text", text: p.text }
          : p.data
            ? { type: "image", source: { type: "base64", media_type: p.mime || "image/png", data: p.data } }
            : { type: "image", source: { type: "url", url: p.url } },
      ),
  }));
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: req.maxTokens || defaultMaxTokens(model),
    stream: true,
  };
  if (req.system) body.system = req.system;
  if (req.temperature != null) body.temperature = Math.min(1, req.temperature);
  else if (req.topP != null) body.top_p = req.topP;
  if (req.stop?.length) body.stop_sequences = req.stop;
  return body;
}

export async function claudeChat(t: Target, req: IChatRequest, signal?: AbortSignal): Promise<AsyncGenerator<IChatEvent>> {
  const res = await fetchUpstream(
    `${t.base}/messages`,
    { method: "POST", headers: claudeHeaders(t), body: JSON.stringify(claudeBody(req, t.upstreamModel)) },
    t.channel.timeoutMs,
    signal,
    t.channel.name,
  );
  return parseClaudeResponse(res);
}

export function mapClaudeStop(r?: string | null) {
  if (r === "max_tokens") return "length";
  return "stop";
}

export async function* parseClaudeResponse(res: Response): AsyncGenerator<IChatEvent> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await res.json();
    for (const b of j.content || []) {
      if (b.type === "thinking" && b.thinking) yield { type: "reasoning", text: b.thinking };
      if (b.type === "text" && b.text) yield { type: "text", text: b.text };
    }
    if (j.usage) yield { type: "usage", usage: { input: j.usage.input_tokens || 0, output: j.usage.output_tokens || 0 } };
    yield { type: "finish", reason: mapClaudeStop(j.stop_reason) };
    return;
  }
  if (!res.body) return;
  yield* parseClaudeSSE(res.body);
}

export async function* parseClaudeSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<IChatEvent> {
  let input = 0;
  let output = 0;
  let stop: string | null = null;
  for await (const ev of readSSE(body)) {
    let j: Record<string, any>;
    try {
      j = JSON.parse(ev.data);
    } catch {
      continue;
    }
    switch (j.type) {
      case "message_start":
        input = j.message?.usage?.input_tokens || 0;
        input += j.message?.usage?.cache_read_input_tokens || 0;
        input += j.message?.usage?.cache_creation_input_tokens || 0;
        output = j.message?.usage?.output_tokens || 0;
        break;
      case "content_block_delta":
        if (j.delta?.type === "text_delta" && j.delta.text) yield { type: "text", text: j.delta.text };
        else if (j.delta?.type === "thinking_delta" && j.delta.thinking) yield { type: "reasoning", text: j.delta.thinking };
        break;
      case "message_delta":
        if (j.usage?.output_tokens != null) output = j.usage.output_tokens;
        if (j.usage?.input_tokens) input = j.usage.input_tokens;
        if (j.delta?.stop_reason) stop = j.delta.stop_reason;
        break;
      case "error":
        throw new RelayError("http", j.error?.message || "上游返回错误", j.error?.type === "overloaded_error" ? 529 : 500);
    }
  }
  yield { type: "usage", usage: { input, output } };
  yield { type: "finish", reason: mapClaudeStop(stop) };
}

export async function claudeListModels(t: Target): Promise<string[]> {
  const res = await fetchUpstream(
    `${t.base}/models?limit=1000`,
    { headers: claudeHeaders(t) },
    20000,
    undefined,
    t.channel.name,
  );
  const j = await res.json();
  return ((j.data || []) as { id: string }[]).map((m) => m.id).filter(Boolean);
}
