import { guard } from "@/lib/server/auth";
import { dbUsage } from "@/lib/server/dbstats";
import { withDb } from "@/lib/server/dbguard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 数据库容量看板：只在设置页打开这一块或点「刷新」时调用 */
async function GETHandler() {
  const g = await guard();
  if (g) return g;
  return Response.json(await dbUsage(), { headers: { "Cache-Control": "no-store" } });
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const GET = withDb(GETHandler);
