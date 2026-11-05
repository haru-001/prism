import { guard } from "@/lib/server/auth";
import { bad, readJSON } from "@/lib/server/api";
import { deleteToken, updateToken } from "@/lib/server/tokens";
import { resetTokenUsage, tokenUsage } from "@/lib/server/stats";
import { settle } from "@/lib/server/defer";
import { withDb } from "@/lib/server/dbguard";

export const dynamic = "force-dynamic";

/** 改名字、限制、启停；resetKey=true 换新 Key；resetUsage=true 已用额度清零 */
async function PATCHHandler(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g) return g;
  const { id } = await ctx.params;
  const b = await readJSON<Record<string, unknown>>(req);
  if (!b) return bad("请求体不是合法 JSON");
  const t = await updateToken(id, b);
  if (!t) return bad("令牌不存在", 404);
  if (b.resetUsage) {
    await settle();
    await resetTokenUsage(id);
  }
  return Response.json({ token: { ...t, used: await tokenUsage(id, { fresh: !!b.resetUsage }) } });
}

async function DELETEHandler(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g) return g;
  const { id } = await ctx.params;
  if (id === "default") return bad("默认令牌不能删除，可以停用或换新 Key");
  if (!(await deleteToken(id))) return bad("令牌不存在", 404);
  return Response.json({ ok: true });
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const PATCH = withDb(PATCHHandler);
export const DELETE = withDb(DELETEHandler);
