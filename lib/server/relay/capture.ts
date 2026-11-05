import "server-only";
import { randomId } from "../crypto";
import { defer } from "../defer";
import { maskHeaders, packRequestBody, packResponseBody, RES_MAX, saveDetail } from "../logdetail";
import type { TokenCtx } from "../tokens";

/**
 * 一次请求的上下文：日志 id、用的哪个令牌。addLog 用它把日志、用量统计和详情关联起来。
 */
export interface ReqCtx {
  logId: string;
  token?: TokenCtx;
  /** 有没有写过日志（没写过日志的请求不存详情，比如令牌无效） */
  logged: boolean;
  replayOf?: string;
}

export function newCtx(token?: TokenCtx, replayOf?: string): ReqCtx {
  return { logId: randomId(), token, logged: false, replayOf };
}

/**
 * 包一层记录详情：先读下请求体（交给处理函数的是一份副本），
 * 响应边发边留一份开头（最多 16KB），发完以后在后台存起来。不影响流式输出的速度。
 */
export async function captured(req: Request, ctx: ReqCtx, run: (req: Request) => Promise<Response>): Promise<Response> {
  const raw = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
  const copy = new Request(req.url, { method: req.method, headers: req.headers, body: raw || undefined, signal: req.signal });
  const url = new URL(req.url);
  const reqHeaders = maskHeaders(req.headers);
  const res = await run(copy);

  const finish = (body: string, cut: boolean) => {
    if (!ctx.logged) return;
    const packed = packRequestBody(raw);
    defer(
      () =>
        saveDetail({
          id: ctx.logId,
          at: Date.now(),
          request: { method: req.method, path: url.pathname + (url.search ? maskQuery(url.search) : ""), headers: reqHeaders, body: packed.body },
          response: { status: res.status, headers: maskHeaders(res.headers), body: packResponseBody(body, cut) },
          truncated: packed.truncated,
          replayOf: ctx.replayOf,
        }),
      "写日志详情",
    );
  };

  if (!res.body) {
    finish("", false);
    return res;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let kept = "";
  let cut = false;
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    kept += dec.decode();
    finish(kept, cut);
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(c) {
      try {
        const r = await reader.read();
        if (r.done) {
          c.close();
          end();
          return;
        }
        if (!cut) {
          kept += dec.decode(r.value, { stream: true });
          if (kept.length > RES_MAX) {
            kept = kept.slice(0, RES_MAX);
            cut = true;
          }
        }
        c.enqueue(r.value);
      } catch (e) {
        c.error(e);
        end();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {});
      end();
    },
  });
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

function maskQuery(search: string) {
  const sp = new URLSearchParams(search);
  if (sp.has("key")) sp.set("key", "****");
  const s = sp.toString();
  return s ? "?" + s : "";
}
