import { guard } from "@/lib/server/auth";
import { withDb } from "@/lib/server/dbguard";
import { getTask } from "@/lib/server/video/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 智谱的结果在这里转存（下载几 MB 的视频），给足时间
export const maxDuration = 120;

/** 查任务状态：前端每隔几秒来问一次；智谱的任务在这里顺便去问对方、成功就转存 */
async function GETHandler(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g) return g;
  const { id } = await ctx.params;
  const task = await getTask(id);
  if (!task) return Response.json({ error: "任务不存在或已过期（任务记录保留 3 天）" }, { status: 404 });
  return Response.json({ task }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withDb(GETHandler);
