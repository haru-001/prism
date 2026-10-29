import { guard } from "@/lib/server/auth";
import { getChannel, patchChannel } from "@/lib/server/store";
import { bad } from "@/lib/server/api";
import { makeTarget } from "@/lib/server/relay/target";
import { adapterListModels } from "@/lib/server/relay/adapters";
import { pickPopular } from "@/lib/models";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 「获取模型」：按渠道类型调对应的模型列表接口 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g) return g;
  const { id } = await ctx.params;
  const ch = await getChannel(id);
  if (!ch) return bad("渠道不存在", 404);
  const t0 = Date.now();
  try {
    const models = [...new Set(await adapterListModels(makeTarget(ch, "")))].sort();
    const latencyMs = Date.now() - t0;
    await patchChannel(id, { allModels: models, status: { ok: true, latencyMs, at: Date.now() } });
    return Response.json({ models, popular: pickPopular(models), latencyMs });
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    const status = (e as { status?: number })?.status;
    return Response.json({ error: status ? `${status} · ${msg}` : msg }, { status: 502 });
  }
}
