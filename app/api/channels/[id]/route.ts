import { guard } from "@/lib/server/auth";
import { deleteChannel, getChannel, upsertChannel } from "@/lib/server/store";
import { encrypt, maskKey } from "@/lib/server/crypto";
import { bad, readJSON, toPublic } from "@/lib/server/api";
import type { Channel } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const g = await guard();
  if (g) return g;
  const { id } = await ctx.params;
  const ch = await getChannel(id);
  if (!ch) return bad("渠道不存在", 404);
  const b = await readJSON<Partial<Channel> & { key?: string }>(req);
  if (!b) return bad("请求体不是合法 JSON");
  const next: Channel = { ...ch };
  if (typeof b.name === "string" && b.name.trim()) next.name = b.name.trim();
  if (typeof b.baseUrl === "string" && b.baseUrl.trim()) next.baseUrl = b.baseUrl.trim();
  if (typeof b.key === "string" && b.key.trim()) {
    next.keyEnc = encrypt(b.key.trim());
    next.keyHint = maskKey(b.key.trim());
  }
  if (Array.isArray(b.models)) next.models = [...new Set(b.models.map(String).filter(Boolean))];
  if (Array.isArray(b.allModels)) next.allModels = [...new Set(b.allModels.map(String).filter(Boolean))];
  if (b.mapping && typeof b.mapping === "object") next.mapping = b.mapping;
  if (b.caps && typeof b.caps === "object") next.caps = b.caps;
  if (b.priority != null && Number.isFinite(Number(b.priority))) next.priority = Number(b.priority);
  if (b.timeoutMs != null) next.timeoutMs = Math.max(5000, Number(b.timeoutMs) || 60000);
  if (typeof b.apiVersion === "string") next.apiVersion = b.apiVersion.trim() || undefined;
  if (typeof b.enabled === "boolean") {
    next.enabled = b.enabled;
    if (b.enabled) {
      // 手动重新启用时清掉自动停用状态
      next.autoDisabled = false;
      next.disabledReason = undefined;
      next.timeoutStreak = 0;
    }
  }
  await upsertChannel(next);
  return Response.json({ channel: toPublic(next) });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await guard();
  if (g) return g;
  const { id } = await ctx.params;
  await deleteChannel(id);
  return Response.json({ ok: true });
}
