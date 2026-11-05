import { guard } from "@/lib/server/auth";
import { bad, readJSON } from "@/lib/server/api";
import { BackupError, checkBackupPassword, collectBackup, parseSections, sealBackup } from "@/lib/server/backup";
import { withDb } from "@/lib/server/dbguard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 导出加密备份：{ password, sections } → 直接下载文件 */
async function POSTHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const b = await readJSON<{ password?: string; sections?: unknown }>(req);
  try {
    const pw = checkBackupPassword(b?.password);
    const sections = parseSections(b?.sections);
    if (!sections.length) return bad("至少选一项要备份的内容");
    const data = await collectBackup(sections);
    const file = sealBackup(data, pw);
    const d = new Date(data.createdAt);
    const p = (n: number) => String(n).padStart(2, "0");
    const name = `prism-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.prismbak`;
    return new Response(file, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
        "X-Prism-Backup-Counts": encodeURIComponent(
          JSON.stringify({ channels: data.channels?.length, tokens: data.tokens?.length, conversations: data.conversations?.length, presets: data.settings?.presets.length }),
        ),
      },
    });
  } catch (e) {
    if (e instanceof BackupError) return bad(e.message);
    throw e;
  }
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const POST = withDb(POSTHandler);
