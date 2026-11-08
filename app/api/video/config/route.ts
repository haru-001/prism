import { guard } from "@/lib/server/auth";
import { readJSON } from "@/lib/server/api";
import { withDb } from "@/lib/server/dbguard";
import { checkKey, deleteVideoKey, getVideoConfig, setVideoDefaults, setVideoKey, toPublicVideo } from "@/lib/server/video/config";
import type { VideoMode, VideoProvider } from "@/lib/video";

export const dynamic = "force-dynamic";

const isProvider = (v: unknown): v is VideoProvider => v === "hf" || v === "zhipu";

/** 视频服务设置：Key 只进不出（返回打码提示），默认服务和各模式的 Space */
async function GETHandler() {
  const g = await guard();
  if (g) return g;
  return Response.json({ config: toPublicVideo(await getVideoConfig()) });
}

/** 改默认服务 / Space */
async function PUTHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const b = await readJSON<{ provider?: unknown; hfSpace?: Partial<Record<VideoMode, unknown>> }>(req);
  if (!b) return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  return Response.json({ config: toPublicVideo(await setVideoDefaults(b)) });
}

/** 添加（或替换）Key */
async function POSTHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const b = await readJSON<{ provider?: unknown; key?: unknown }>(req);
  if (!b || !isProvider(b.provider)) return Response.json({ error: "服务不对" }, { status: 400 });
  const key = checkKey(b.provider, b.key);
  if (!key)
    return Response.json(
      { error: b.provider === "hf" ? "这不像 Hugging Face 令牌：应该以 hf_ 开头，中间没有空格" : "Key 格式不对，请从智谱控制台完整复制" },
      { status: 400 },
    );
  return Response.json({ config: toPublicVideo(await setVideoKey(b.provider, key)) });
}

async function DELETEHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const p = new URL(req.url).searchParams.get("provider");
  if (!isProvider(p)) return Response.json({ error: "服务不对" }, { status: 400 });
  return Response.json({ config: toPublicVideo(await deleteVideoKey(p)) });
}

export const GET = withDb(GETHandler);
export const PUT = withDb(PUTHandler);
export const POST = withDb(POSTHandler);
export const DELETE = withDb(DELETEHandler);
