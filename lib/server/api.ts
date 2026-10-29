import "server-only";
import type { Channel, MsgError, PublicChannel } from "../types";
import { normalizeBaseUrl } from "../models";
import { callName, copy, fill } from "../copy";
import { RelayError } from "./relay/errors";
import type { Settings } from "../types";

export function toPublic(ch: Channel): PublicChannel {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { keyEnc, ...rest } = ch;
  return { ...rest, endpoint: normalizeBaseUrl(ch.type, ch.baseUrl) };
}

export async function readJSON<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/** 把线路错误翻译成棱音的话 */
export function describeError(e: unknown, settings: Settings, model: string): MsgError {
  const name = callName(settings.callMode, settings.customName);
  const err = e instanceof RelayError ? e : new RelayError("network", (e as Error)?.message || String(e));
  const msg = err.message;
  const status = err.status;
  const via = err.channel ? `（${err.channel}）` : "";
  if (err.kind === "nochannel") return { title: "没有可用线路", message: fill(copy.errors.noChannel, { model, name }), fix: "channels" };
  if (err.kind === "timeout") return { title: `上游超时${via}`, message: fill(copy.errors.timeout, { name }), status: 504, fix: "channels" };
  if (err.kind === "network") return { title: `连不上上游${via}`, message: fill(copy.errors.network, { msg, name }), fix: "channels" };
  if (err.kind === "unsupported" || err.kind === "bad") return { title: "请求没法处理", message: fill(copy.errors.unsupported, { msg }) };
  if (status === 401) return { title: `上游 401${via}`, message: fill(copy.errors[401], { name }) + `\n原始信息：${msg}`, status, fix: "channels" };
  if (status === 403) return { title: `上游 403${via}`, message: fill(copy.errors[403], { name }) + `\n原始信息：${msg}`, status, fix: "channels" };
  if (status === 404) return { title: `上游 404${via}`, message: fill(copy.errors[404], { name }) + `\n原始信息：${msg}`, status, fix: "channels" };
  if (status === 429) return { title: `上游限流${via}`, message: fill(copy.errors[429], { name }) + `\n原始信息：${msg}`, status };
  if (status === 400) return { title: `上游 400${via}`, message: fill(copy.errors[400], { msg }), status };
  if (status && status >= 500) return { title: `上游 ${status}${via}`, message: fill(copy.errors[500], { status }) + `\n原始信息：${msg}`, status };
  return { title: `出错了${via}`, message: fill(copy.errors.unknown, { msg }), status };
}
