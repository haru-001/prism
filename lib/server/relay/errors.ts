import "server-only";

export type ErrKind = "http" | "timeout" | "network" | "nochannel" | "unsupported" | "bad";

export class RelayError extends Error {
  kind: ErrKind;
  status?: number;
  channel?: string;
  constructor(kind: ErrKind, message: string, status?: number, channel?: string) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.channel = channel;
  }
  /** 对外返回时用的 HTTP 状态码 */
  get httpStatus(): number {
    if (this.kind === "timeout") return 504;
    if (this.kind === "network") return 502;
    if (this.kind === "nochannel") return 503;
    if (this.kind === "unsupported" || this.kind === "bad") return 400;
    return this.status || 500;
  }
}

export function extractMessage(text: string): string {
  try {
    const j = JSON.parse(text);
    const e = Array.isArray(j) ? j[0]?.error : j.error;
    if (typeof e === "string") return e;
    if (e?.message) return String(e.message);
    if (j.message) return String(j.message);
    if (j.detail) return typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
  } catch {
    /* 不是 JSON */
  }
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) || "未知错误";
}

export async function errorFromResponse(res: Response, channel?: string): Promise<RelayError> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    /* ignore */
  }
  return new RelayError("http", extractMessage(text) || res.statusText, res.status, channel);
}

export function toRelayError(e: unknown, channel?: string): RelayError {
  if (e instanceof RelayError) {
    if (!e.channel) e.channel = channel;
    return e;
  }
  const err = e as Error & { cause?: { code?: string; message?: string } };
  const msg = err?.cause?.message || err?.message || String(e);
  return new RelayError("network", msg, undefined, channel);
}

/**
 * 带超时的 fetch：只限制「等到响应头」的时间，流式正文不受影响。
 * outer 是客户端断开时的信号，会一路传到上游。
 */
export async function fetchUpstream(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  outer?: AbortSignal,
  channel?: string,
): Promise<Response> {
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, timeoutMs);
  const onOuter = () => ac.abort();
  if (outer) {
    if (outer.aborted) ac.abort();
    else outer.addEventListener("abort", onOuter, { once: true });
  }
  try {
    const res = await fetch(url, { ...init, signal: ac.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) throw await errorFromResponse(res, channel);
    return res;
  } catch (e) {
    clearTimeout(timer);
    if (timedOut) throw new RelayError("timeout", `等待上游响应超过 ${Math.round(timeoutMs / 1000)} 秒`, 504, channel);
    throw toRelayError(e, channel);
  }
}
