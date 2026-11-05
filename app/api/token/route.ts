import { getApiToken, guard, resetApiToken } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { withDb } from "@/lib/server/dbguard";

export const dynamic = "force-dynamic";

async function GETHandler() {
  const g = await guard();
  if (g) return g;
  return Response.json({ token: await getApiToken(), envToken: !!env.apiToken });
}

/** 重置令牌：旧令牌立刻失效（环境变量里的 PRISM_API_TOKEN 不受影响） */
async function POSTHandler() {
  const g = await guard();
  if (g) return g;
  return Response.json({ token: await resetApiToken(), envToken: !!env.apiToken });
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const GET = withDb(GETHandler);
export const POST = withDb(POSTHandler);
