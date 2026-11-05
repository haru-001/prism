import { guard } from "@/lib/server/auth";
import { clearUsage, usageReport } from "@/lib/server/stats";
import { listTokens } from "@/lib/server/tokens";
import { settle } from "@/lib/server/defer";
import { withDb } from "@/lib/server/dbguard";

export const dynamic = "force-dynamic";

/** 用量统计：?days=7|30|90 */
async function GETHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const d = Number(new URL(req.url).searchParams.get("days"));
  const days = [1, 7, 14, 30, 90, 180, 365].includes(d) ? d : 7;
  // 本实例还没落库的用量先写完，统计里能看到刚刚那条请求
  await settle();
  const [report, tokens] = await Promise.all([usageReport(days), listTokens()]);
  const names: Record<string, string> = { web: "网页聊天", env: "环境变量令牌", replay: "日志重放", "-": "未知" };
  for (const t of tokens) names[t.id] = t.name;
  return Response.json({ ...report, tokenNames: names });
}

async function DELETEHandler() {
  const g = await guard();
  if (g) return g;
  await settle();
  await clearUsage();
  return Response.json({ ok: true });
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const GET = withDb(GETHandler);
export const DELETE = withDb(DELETEHandler);
