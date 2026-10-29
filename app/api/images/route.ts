import { guard } from "@/lib/server/auth";
import { addGallery, addLog, getSettings } from "@/lib/server/store";
import { describeError, readJSON } from "@/lib/server/api";
import { resolveImage, saveFile } from "@/lib/server/files";
import { adapterImage } from "@/lib/server/relay/adapters";
import { logFailure, withFailover, type FailoverError } from "@/lib/server/relay/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 生图慢，单独调大函数最长执行时间
export const maxDuration = 300;

interface Body {
  model: string;
  channelId?: string;
  prompt: string;
  size?: string;
  n?: number;
  quality?: "low" | "medium" | "high";
  refs?: string[];
  convId?: string;
}

export async function POST(req: Request) {
  const g = await guard();
  if (g) return g;
  const b = await readJSON<Body>(req);
  if (!b?.model || !b.prompt?.trim()) return Response.json({ error: { title: "参数不完整", message: "请先写好描述、选好生图模型" } }, { status: 400 });
  const settings = await getSettings();
  const startedAt = Date.now();
  try {
    const refs = await Promise.all((b.refs || []).slice(0, 4).map((u) => resolveImage(u)));
    const r = await withFailover(
      b.model,
      (t) =>
        adapterImage(
          t,
          { model: t.upstreamModel, prompt: b.prompt.trim(), n: Math.min(4, Math.max(1, Number(b.n) || 1)), size: b.size, quality: b.quality, refs },
          req.signal,
        ),
      { prefer: b.channelId },
    );
    const urls: string[] = [];
    for (const im of r.value) {
      if (im.b64) urls.push(await saveFile(Buffer.from(im.b64, "base64"), im.mime || "image/png"));
      else if (im.url) {
        // 上游给的是临时链接，转存一份
        try {
          const f = await resolveImage(im.url);
          urls.push(await saveFile(Buffer.from(f.data, "base64"), f.mime));
        } catch {
          urls.push(im.url);
        }
      }
    }
    await addGallery(urls.map((url) => ({ url, prompt: b.prompt.trim(), model: b.model, size: b.size, convId: b.convId })));
    const latencyMs = Date.now() - startedAt;
    await addLog({
      source: "ui-image",
      model: b.model,
      upstreamModel: r.target.upstreamModel,
      channel: r.target.channel.name,
      ok: true,
      latencyMs,
      attempts: r.attempts,
    });
    return Response.json({
      images: urls,
      channel: r.target.channel.name,
      latencyMs,
      notices: r.notices,
      revisedPrompt: r.value.find((x) => x.revisedPrompt)?.revisedPrompt,
    });
  } catch (e) {
    await logFailure("ui-image", b.model, e, startedAt);
    return Response.json({ error: describeError(e, settings, b.model), notices: (e as FailoverError).notices || [] });
  }
}
