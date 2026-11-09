import { guard } from "@/lib/server/auth";
import { loadBoot } from "@/lib/server/boot";
import { withDb } from "@/lib/server/dbguard";

export const dynamic = "force-dynamic";

async function GETHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const fresh = new URL(req.url).searchParams.has("fresh");
  return Response.json(await loadBoot({ fresh }));
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const GET = withDb(GETHandler);
