import "server-only";
import { waitUntil } from "@vercel/functions";

/**
 * 把不影响响应内容的写入（请求日志、线路状态）放到后台做：响应先返回，写库稍后完成。
 * Vercel 上用 waitUntil 保证函数在写完之前不会被挂起；本地进程常驻，直接跑完。
 * 同一实例里读日志前会先等这些写入落库（settle），所以刚发的请求马上就能在日志里看到。
 */
const g = globalThis as unknown as { __prismPending?: Set<Promise<unknown>> };
const pending = (g.__prismPending ??= new Set());

export function defer(work: Promise<unknown> | (() => Promise<unknown>), label = "后台写入") {
  const p = (typeof work === "function" ? work() : work).catch((e) => console.error(`[prism] ${label}失败`, e));
  pending.add(p);
  void p.finally(() => pending.delete(p));
  try {
    waitUntil(p);
  } catch {}
}

export async function settle() {
  if (pending.size) await Promise.allSettled([...pending]);
}
