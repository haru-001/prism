import { getApiToken, guard, resetApiToken } from "@/lib/server/auth";
import { env } from "@/lib/server/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guard();
  if (g) return g;
  return Response.json({ token: await getApiToken(), envToken: !!env.apiToken });
}

/** 重置令牌：旧令牌立刻失效（环境变量里的 PRISM_API_TOKEN 不受影响） */
export async function POST() {
  const g = await guard();
  if (g) return g;
  return Response.json({ token: await resetApiToken(), envToken: !!env.apiToken });
}
