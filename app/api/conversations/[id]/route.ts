import { guard } from "@/lib/server/auth";
import { deleteConversation, getConversation, saveConversation } from "@/lib/server/store";
import { bad, readJSON } from "@/lib/server/api";
import type { Conversation } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const g = await guard();
  if (g) return g;
  const { id } = await ctx.params;
  const c = await getConversation(id);
  if (!c) return bad("对话不存在", 404);
  return Response.json({ conversation: c });
}

export async function PUT(req: Request, ctx: Ctx) {
  const g = await guard();
  if (g) return g;
  const { id } = await ctx.params;
  const b = await readJSON<Conversation>(req);
  if (!b || !Array.isArray(b.messages)) return bad("参数不完整");
  const now = Date.now();
  const c: Conversation = {
    id,
    title: (b.title || "新对话").slice(0, 80),
    hasImage: b.messages.some((m) => m.mode === "image"),
    model: b.model,
    system: b.system,
    temperature: b.temperature,
    // 不保存进行中的消息和 base64 大图
    messages: b.messages
      .filter((m) => !m.pending)
      .map((m) => ({ ...m, images: m.images?.filter((u) => !u.startsWith("data:")) })),
    createdAt: b.createdAt || now,
    updatedAt: now,
  };
  await saveConversation(c);
  return Response.json({ ok: true, updatedAt: now });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await guard();
  if (g) return g;
  const { id } = await ctx.params;
  await deleteConversation(id);
  return Response.json({ ok: true });
}
