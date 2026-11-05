import { guard } from "@/lib/server/auth";
import { bad, readJSON } from "@/lib/server/api";
import { BackupError, openBackup, previewBackup } from "@/lib/server/backup";
import { withDb } from "@/lib/server/dbguard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 恢复前预览：{ file: 备份文件内容, password } → 会覆盖、新增、保留哪些 */
async function POSTHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const b = await readJSON<{ file?: string; password?: string }>(req);
  if (!b?.file) return bad("请先选择备份文件");
  try {
    const data = openBackup(b.file, String(b.password || ""));
    return Response.json({ preview: await previewBackup(data) });
  } catch (e) {
    if (e instanceof BackupError) return bad(e.message);
    throw e;
  }
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const POST = withDb(POSTHandler);
