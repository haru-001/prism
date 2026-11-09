import { guard } from "@/lib/server/auth";
import { bad, readJSON } from "@/lib/server/api";
import { getPricing, normalizePricing, savePricing } from "@/lib/server/stats";
import { withDb } from "@/lib/server/dbguard";

export const dynamic = "force-dynamic";

async function GETHandler() {
  const g = await guard();
  if (g) return g;
  return Response.json({ pricing: await getPricing() });
}

async function PUTHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const b = await readJSON<{ pricing: unknown }>(req);
  if (!b?.pricing) return bad("缺少 pricing");
  const pricing = normalizePricing(b.pricing);
  await savePricing(pricing);
  return Response.json({ pricing });
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const GET = withDb(GETHandler);
export const PUT = withDb(PUTHandler);
