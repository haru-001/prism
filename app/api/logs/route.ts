import { guard } from "@/lib/server/auth";
import { clearLogs, listLogs } from "@/lib/server/store";
import { withDb } from "@/lib/server/dbguard";

export const dynamic = "force-dynamic";

async function GETHandler() {
  const g = await guard();
  if (g) return g;
  return Response.json({ logs: await listLogs() });
}

async function DELETEHandler() {
  const g = await guard();
  if (g) return g;
  await clearLogs();
  return Response.json({ ok: true });
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const GET = withDb(GETHandler);
export const DELETE = withDb(DELETEHandler);
