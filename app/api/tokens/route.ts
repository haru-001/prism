import { guard } from "@/lib/server/auth";
import { readJSON } from "@/lib/server/api";
import { createToken, listTokens } from "@/lib/server/tokens";
import { tokenUsage } from "@/lib/server/stats";
import { settle } from "@/lib/server/defer";
import { env } from "@/lib/server/env";
import { withDb } from "@/lib/server/dbguard";

export const dynamic = "force-dynamic";

async function GETHandler() {
  const g = await guard();
  if (g) return g;
  await settle();
  const list = await listTokens({ fresh: true });
  const tokens = await Promise.all(list.map(async (t) => ({ ...t, used: await tokenUsage(t.id, { fresh: true }) })));
  return Response.json({ tokens, envToken: !!env.apiToken });
}

async function POSTHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const b = (await readJSON<Record<string, unknown>>(req)) || {};
  const token = await createToken(b);
  return Response.json({ token: { ...token, used: { tokens: 0, cost: 0 } } });
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const GET = withDb(GETHandler);
export const POST = withDb(POSTHandler);
