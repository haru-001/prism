import { guard } from "@/lib/server/auth";
import { getChannel, patchChannel } from "@/lib/server/store";
import { bad, readJSON } from "@/lib/server/api";
import { makeTarget } from "@/lib/server/relay/target";
import { adapterChat, adapterListModels } from "@/lib/server/relay/adapters";
import { capsFor, exposedModels } from "@/lib/server/relay/router";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 测试线路：用一个对话模型发一句极短的请求；没有对话模型时退回「拉模型列表」 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g) return g;
  const { id } = await ctx.params;
  const ch = await getChannel(id);
  if (!ch) return bad("渠道不存在", 404);
  const body = (await readJSON<{ model?: string }>(req)) || {};
  const chatModel =
    exposedModels(ch).find((m) => (body.model ? m.id === body.model : capsFor(ch, m.id, m.upstream).includes("chat"))) || null;
  const t0 = Date.now();
  try {
    let latencyMs: number;
    let via: string;
    if (chatModel) {
      const t = makeTarget({ ...ch, timeoutMs: Math.min(ch.timeoutMs, 30000) }, chatModel.upstream);
      const events = await adapterChat(t, {
        model: chatModel.upstream,
        messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
        maxTokens: 16,
        stream: true,
      });
      latencyMs = Date.now() - t0;
      for await (const ev of events) void ev; // 把流读完，顺便检查流里的错误
      via = chatModel.id;
    } else {
      await adapterListModels(makeTarget(ch, ""));
      latencyMs = Date.now() - t0;
      via = "模型列表";
    }
    await patchChannel(id, {
      status: { ok: true, latencyMs, at: Date.now() },
      timeoutStreak: 0,
      autoDisabled: false,
      disabledReason: undefined,
    });
    return Response.json({ ok: true, latencyMs, via });
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    const status = (e as { status?: number })?.status;
    const message = status ? `${status} · ${msg}` : msg;
    await patchChannel(id, { status: { ok: false, message: message.slice(0, 200), at: Date.now() } });
    return Response.json({ ok: false, message, via: chatModel?.id || "模型列表" });
  }
}
