import { guard } from "@/lib/server/auth";
import { bad, readJSON } from "@/lib/server/api";
import { BackupError, openBackup, parseSections, restoreBackup } from "@/lib/server/backup";
import { withDb } from "@/lib/server/dbguard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 恢复：{ file, password, sections } → 同 ID 覆盖、其余保留 */
async function POSTHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const b = await readJSON<{ file?: string; password?: string; sections?: unknown }>(req);
  if (!b?.file) return bad("请先选择备份文件");
  const sections = parseSections(b.sections);
  if (!sections.length) return bad("至少选一项要恢复的内容");
  try {
    const data = openBackup(b.file, String(b.password || ""));
    return Response.json({ restored: await restoreBackup(data, sections) });
  } catch (e) {
    if (e instanceof BackupError) return bad(e.message);
    throw e;
  }
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const POST = withDb(POSTHandler);
