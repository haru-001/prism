import { guard } from "@/lib/server/auth";
import { bad, readJSON } from "@/lib/server/api";
import { cleanup, CLEANUP_TYPES, type CleanupType } from "@/lib/server/dbstats";
import { withDb } from "@/lib/server/dbguard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 清理旧数据：{ type, olderThanDays, confirm }
 * - 不带 confirm：只预览会删多少条、大约多大（前端拿来给用户确认）
 * - confirm: true：真的删除，然后整理表、重新量一次容量
 */
async function POSTHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const b = await readJSON<{ type?: string; olderThanDays?: number; confirm?: boolean }>(req);
  const type = b?.type as CleanupType;
  if (!CLEANUP_TYPES.includes(type)) return bad("请选择要清理的数据类型");
  const days = Number(b?.olderThanDays);
  if (!Number.isFinite(days) || days < 0 || days > 3650) return bad("时间范围不对");
  try {
    return Response.json(await cleanup(type, days, b?.confirm !== true));
  } catch (e) {
    if ((e as Error)?.message?.includes("本地文件存储")) return bad((e as Error).message);
    throw e;
  }
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const POST = withDb(POSTHandler);
