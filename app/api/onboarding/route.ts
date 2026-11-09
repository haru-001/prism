import { guard } from "@/lib/server/auth";
import { getOnboarding, saveOnboarding } from "@/lib/server/store";
import { readJSON } from "@/lib/server/api";
import { withDb } from "@/lib/server/dbguard";

export const dynamic = "force-dynamic";

/** 引导进度：completed 完成引导；tip 记下某条提示已看过；reset 重新看引导 */
async function PUTHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const b = (await readJSON<{ completed?: boolean; tip?: string; reset?: boolean }>(req)) || {};
  if (b.reset) return Response.json({ onboarding: await saveOnboarding({ completed: false, seenTips: [] }) });
  const cur = await getOnboarding();
  const patch: { completed?: boolean; seenTips?: string[] } = {};
  if (typeof b.completed === "boolean") patch.completed = b.completed;
  if (b.tip && !cur.seenTips.includes(b.tip)) patch.seenTips = [...cur.seenTips, b.tip];
  return Response.json({ onboarding: await saveOnboarding(patch) });
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const PUT = withDb(PUTHandler);
