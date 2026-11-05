import { guard } from "@/lib/server/auth";
import { settle } from "@/lib/server/defer";
import { replayLog } from "@/lib/server/replay";
import { withDb } from "@/lib/server/dbguard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 重放生图请求可能要很久
export const maxDuration = 300;

async function POSTHandler(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g) return g;
  const { id } = await ctx.params;
  await settle();
  const r = await replayLog(id);
  // 重放不赶时间：等新日志落库再返回，页面刷新就能看到
  await settle();
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ result: r });
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const POST = withDb(POSTHandler);
