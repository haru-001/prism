import { guard } from "@/lib/server/auth";
import { deleteConversation, getConversation, saveConversation } from "@/lib/server/store";
import { bad, readJSON } from "@/lib/server/api";
import type { Conversation } from "@/lib/types";
import { withDb } from "@/lib/server/dbguard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function GETHandler(_req: Request, ctx: Ctx) {
  const g = await guard();
  if (g) return g;
  const { id } = await ctx.params;
  const c = await getConversation(id);
  if (!c) return bad("对话不存在", 404);
  return Response.json({ conversation: c });
}

async function PUTHandler(req: Request, ctx: Ctx) {
  const g = await guard();
  if (g) return g;
  const { id } = await ctx.params;
  const b = await readJSON<Conversation>(req);
  if (!b || !Array.isArray(b.messages)) return bad("参数不完整");
  const now = Date.now();
  const c: Conversation = {
    id,
    title: (b.title || "新对话").slice(0, 80),
    hasImage: b.messages.some((m) => m.mode === "image" || m.mode === "video"),
    model: b.model,
    system: b.system,
    temperature: b.temperature,
    // 不保存进行中的消息和 base64 大图；生成中的视频例外（带着任务 id，刷新后接着查进度，完成时服务端会把结果写回来）
    messages: b.messages
      .filter((m) => !m.pending || (m.mode === "video" && typeof m.task?.id === "string" && /^[A-Za-z0-9_-]{6,40}$/.test(m.task.id)))
      .map((m) => ({ ...m, images: m.images?.filter((u) => !u.startsWith("data:")) })),
    createdAt: b.createdAt || now,
    updatedAt: now,
  };
  await saveConversation(c);
  return Response.json({ ok: true, updatedAt: now });
}

async function DELETEHandler(_req: Request, ctx: Ctx) {
  const g = await guard();
  if (g) return g;
  const { id } = await ctx.params;
  await deleteConversation(id);
  return Response.json({ ok: true });
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const GET = withDb(GETHandler);
export const PUT = withDb(PUTHandler);
export const DELETE = withDb(DELETEHandler);
