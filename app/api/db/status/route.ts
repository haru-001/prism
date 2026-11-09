import { pingDb } from "@/lib/server/mysql";
import { env } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 数据库是否醒着：「数据库睡着了」页面的「重试」按钮用。不需要登录（数据库连不上时也没法校验登录），
 * 只返回醒/睡和类型，不暴露任何配置。只在用户点按钮时调用，不轮询。
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (!env.databaseUrl) return Response.json({ ok: true, storage: "file" }, { headers });
  const r = await pingDb();
  if (r.ok) return Response.json({ ok: true, storage: "mysql", ms: r.ms }, { headers });
  const kind = (r.error as { kind?: string }).kind || "down";
  return Response.json({ ok: false, kind }, { status: 503, headers: { ...headers, "Retry-After": "30" } });
}
