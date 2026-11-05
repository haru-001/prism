import { guard } from "@/lib/server/auth";
import { bad } from "@/lib/server/api";
import { getDetail } from "@/lib/server/logdetail";
import { settle } from "@/lib/server/defer";
import { withDb } from "@/lib/server/dbguard";

export const dynamic = "force-dynamic";

/** 一条日志的完整请求和响应（敏感信息已打码） */
async function GETHandler(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g) return g;
  const { id } = await ctx.params;
  // 本实例刚发的请求，详情可能还在后台写，先等它落库
  await settle();
  const detail = await getDetail(id);
  if (!detail) return bad("这条日志的详情已经不在了（只保留最近 500 条）", 404);
  return Response.json({ detail });
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const GET = withDb(GETHandler);
