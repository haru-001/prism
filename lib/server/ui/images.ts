import "server-only";
import { captured, newCtx, type ReqCtx } from "@/lib/server/relay/capture";
import { REPLAY_TOKEN, WEB_TOKEN } from "@/lib/server/tokens";
import { addGallery, addLog, getSettings } from "@/lib/server/store";
import { describeError, readJSON } from "@/lib/server/api";
import { persistRemoteImage, resolveImage, saveFile } from "@/lib/server/files";
import { adapterImage } from "@/lib/server/relay/adapters";
import { logFailure, withFailover, type FailoverError } from "@/lib/server/relay/router";

// 生图慢，单独调大函数最长执行时间

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

/** 网页端请求也记详情（令牌记为「网页聊天」）；日志重放时直接调这里 */
export function runUiImages(req: Request, replayOf?: string) {
  const ctx = newCtx(replayOf ? REPLAY_TOKEN : WEB_TOKEN, replayOf);
  return captured(req, ctx, (r) => handle(r, ctx));
}

async function handle(req: Request, ctx: ReqCtx) {
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
    // 上游给 base64 就直接存；给的是临时链接就由服务端立刻下载转存，浏览器只拿到本站地址
    const urls = (
      await Promise.all(
        r.value.map((im) =>
          im.b64 ? saveFile(Buffer.from(im.b64, "base64"), im.mime || "image/png") : im.url ? persistRemoteImage(im.url) : null,
        ),
      )
    ).filter((u): u is string => !!u);
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
    }, ctx);
    return Response.json({
      images: urls,
      channel: r.target.channel.name,
      latencyMs,
      notices: r.notices,
      revisedPrompt: r.value.find((x) => x.revisedPrompt)?.revisedPrompt,
    });
  } catch (e) {
    await logFailure("ui-image", b.model, e, startedAt, false, ctx);
    return Response.json({ error: describeError(e, settings, b.model), notices: (e as FailoverError).notices || [] });
  }
}
