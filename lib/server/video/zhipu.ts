import "server-only";
import { ZHIPU_MODEL, type VideoAspect } from "../../video";

/**
 * 智谱 BigModel 的 CogVideoX-Flash（官方价格表标注「免费」）。异步接口：
 *   POST https://open.bigmodel.cn/api/paas/v4/videos/generations  → { id, task_status: "PROCESSING" }
 *   GET  https://open.bigmodel.cn/api/paas/v4/async-result/{id}   → { task_status: PROCESSING|SUCCESS|FAIL, video_result: [{ url, cover_image_url }] }
 * 文档：https://docs.bigmodel.cn/api-reference/模型-api/视频生成异步 、 https://docs.bigmodel.cn/api-reference/模型-api/查询异步结果
 * 测试时可以用 PRISM_TEST_ZHIPU_ORIGIN 指到本地模拟服务。
 */
const ORIGIN = (process.env.PRISM_TEST_ZHIPU_ORIGIN || "https://open.bigmodel.cn").replace(/\/+$/, "");
const BASE = ORIGIN + "/api/paas/v4";

export class ZhipuError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(key: string, path: string, init: RequestInit & { timeout?: number } = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers || {}) },
    signal: init.signal || AbortSignal.timeout(init.timeout || 30000),
  });
  const text = await res.text();
  let j: { error?: { code?: string; message?: string } } & Record<string, unknown> = {};
  try {
    j = JSON.parse(text);
  } catch {}
  if (!res.ok || j.error) {
    const msg = j.error?.message || text.slice(0, 300) || `HTTP ${res.status}`;
    throw new ZhipuError(msg, res.status, j.error?.code);
  }
  return j as T;
}

const SIZES: Record<VideoAspect, string> = { "16:9": "1920x1080", "9:16": "1080x1920", "1:1": "1024x1024" };

/** 提交任务。image 是 data:image/jpeg;base64,... （图生视频；CogVideoX-Flash 只支持一张图，不支持首尾帧） */
export async function zhipuSubmit(key: string, b: { prompt: string; image?: string; aspect?: VideoAspect; quality?: boolean }): Promise<string> {
  const body: Record<string, unknown> = {
    model: ZHIPU_MODEL,
    prompt: b.prompt.slice(0, 500),
    quality: b.quality ? "quality" : "speed",
    with_audio: false,
  };
  if (b.image) body.image_url = b.image;
  // 图生视频时不传尺寸，按原图比例出片
  else if (b.aspect && SIZES[b.aspect]) body.size = SIZES[b.aspect];
  const r = await call<{ id?: string; task_status?: string }>(key, "/videos/generations", { method: "POST", body: JSON.stringify(body) });
  if (!r.id) throw new ZhipuError("智谱没有返回任务 ID", 502);
  if (r.task_status === "FAIL") throw new ZhipuError("智谱拒绝了这个任务", 400);
  return r.id;
}

export async function zhipuQuery(key: string, id: string): Promise<{ status: "PROCESSING" | "SUCCESS" | "FAIL"; url?: string; cover?: string }> {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(id)) throw new ZhipuError("任务 ID 不合法", 400);
  const r = await call<{ task_status?: string; video_result?: { url?: string; cover_image_url?: string }[] }>(key, `/async-result/${encodeURIComponent(id)}`, { method: "GET", timeout: 15000 });
  const st = r.task_status === "SUCCESS" ? "SUCCESS" : r.task_status === "FAIL" ? "FAIL" : "PROCESSING";
  const v = r.video_result?.[0];
  return { status: st, url: v?.url, cover: v?.cover_image_url };
}

/** 「测试连接」：查一个不存在的任务。Key 不对会返回 401（1000/1001/1002/1003），Key 对就会是「任务不存在」一类的错误，不消耗额度 */
export async function zhipuTest(key: string): Promise<string> {
  try {
    await call(key, "/async-result/prism-connection-test", { method: "GET", timeout: 15000 });
    return "连接正常";
  } catch (e) {
    const z = e as ZhipuError;
    if (z.status === 401 || /^100[0-4]$/.test(z.code || "")) throw z;
    if (z.status && z.status >= 500) throw z;
    return "连接正常，Key 有效";
  }
}
