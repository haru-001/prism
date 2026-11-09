import "server-only";
import { kv, P } from "../kv";
import { randomId } from "../crypto";
import { addGallery, addLog, patchConversationMessage } from "../store";
import { persistRemotePoster, persistRemoteVideo, resolveImage } from "../files";
import { localImageUrl } from "../imgurl";
import { getVideoConfig, videoKey } from "./config";
import { HfError, findVideoUrl, invokeSpace, uploadToSpace, viewParameters, type SpaceParam } from "./hfmcp";
import { ZhipuError, zhipuQuery, zhipuSubmit } from "./zhipu";
import {
  VIDEO_MODES,
  VIDEO_PROVIDERS,
  ZHIPU_ETA,
  ZHIPU_MODEL,
  parseHfChoice,
  type HfChoice,
  type VideoAspect,
  type VideoError,
  type VideoErrorKind,
  type VideoMode,
  type VideoProvider,
  type VideoResult,
  type VideoStatus,
  type VideoTaskView,
} from "../../video";

/**
 * 视频任务：浏览器「提交 → 拿到任务 id → 每隔几秒查一次状态」，服务端把状态存在 KV（prism:vtask:{id}，3 天后过期）。
 *
 * - Hugging Face：MCP 调 Space 是一次同步长调用（实测 4 秒视频 1–2 分钟），放在提交接口的 after() 里跑，
 *   受这个接口的 maxDuration（300 秒，Vercel Hobby 的上限）约束；我们给自己留 280 秒，超了就按超时失败。
 * - 智谱：提交后拿到对方的任务 id，之后每次浏览器来查状态时顺便去问一次对方（最多 2.5 秒问一次），成功就转存。
 * 完成或失败时，同时更新对话里那条消息和图库，用户中途关掉页面也不会丢结果。
 */

export const HF_BUDGET_MS = Number(process.env.PRISM_TEST_VIDEO_BUDGET_MS) || 280_000;
const TASK_TTL = 3 * 86400;
const KEY = (id: string) => P + "vtask:" + id;

interface TaskRec {
  id: string;
  status: VideoStatus;
  phase?: VideoTaskView["phase"];
  provider: VideoProvider;
  mode: VideoMode;
  prompt: string;
  space?: string;
  tool?: string;
  presetId?: string;
  duration?: number;
  aspect?: VideoAspect;
  images: string[];
  convId?: string;
  msgId?: string;
  label: string;
  startedAt: number;
  updatedAt: number;
  eta: number;
  upstreamId?: string;
  queue?: number;
  progress?: number;
  result?: VideoResult;
  error?: VideoError;
  latencyMs?: number;
  finalizing?: number;
  lastPoll?: number;
}

async function load(id: string) {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return null;
  return kv().get<TaskRec>(KEY(id));
}
async function store(t: TaskRec) {
  t.updatedAt = Date.now();
  await kv().set(KEY(t.id), t, { ex: TASK_TTL });
}

export function toView(t: TaskRec): VideoTaskView {
  let phase = t.phase;
  // 没收到排队信息时，提交 15 秒后按「生成中」显示（MCP 不一定推进度）
  if (t.status === "running" && phase === "queue" && t.queue == null && Date.now() - t.startedAt > 15_000) phase = "generate";
  return {
    id: t.id,
    status: t.status,
    phase,
    queue: t.queue,
    progress: t.progress,
    startedAt: t.startedAt,
    eta: t.eta,
    result: t.result,
    error: t.error,
    latencyMs: t.latencyMs,
    label: t.label,
  };
}

// ===== 错误归类：棱音按类型换台词，界面给出对应的处理办法 =====
function vErr(kind: VideoErrorKind, title: string, message: string): VideoError {
  return { kind, title, message };
}

/** ZeroGPU 给的「Try again in 13:05:21」换成「13 小时 5 分钟」 */
function humanWait(v?: string) {
  if (!v) return undefined;
  const m = /^(?:(\d+):)?(\d+):(\d+)$/.exec(v.trim());
  if (!m) return v.trim();
  const h = Number(m[1] || 0), mi = Number(m[2]), se = Number(m[3]);
  if (h) return `${h} 小时${mi ? ` ${mi} 分钟` : ""}`;
  if (mi) return `${mi} 分钟`;
  return `${se} 秒`;
}

export function classify(e: unknown, provider: VideoProvider): VideoError {
  const msg = String((e as Error)?.message || e || "");
  const raw = msg.length > 240 ? msg.slice(0, 240) + "…" : msg;
  const name = (e as Error)?.name;
  const status = (e as HfError | ZhipuError)?.status;
  const code = (e as ZhipuError)?.code;
  if ((e as { nokey?: boolean })?.nokey) {
    return vErr("nokey", "还没添加 Key", `还没有添加${provider === "hf" ? " Hugging Face 令牌" : "智谱 API Key"}。到「设置 → 视频服务」添加后再试。`);
  }
  if (name === "TimeoutError" || name === "AbortError" || /timed? ?out|超时/i.test(msg) || status === 504) {
    return vErr(
      "timeout",
      "生成超时",
      provider === "hf"
        ? "等了将近 5 分钟还没出片（Vercel 函数最长只能跑 300 秒）。Space 可能排队的人多，可以把时长调短一点再试，或换一个 Space。"
        : "等了很久还没有结果。智谱那边可能比较忙，稍后再试。",
    );
  }
  if (provider === "hf") {
    if (/zero ?gpu|gpu quota|exceeded|quota/i.test(msg)) {
      const again = humanWait(/try again in ([0-9:]+|[^.\n]+?)(?:[.\n]|$)/i.exec(msg)?.[1]);
      return vErr(
        "quota",
        "今天的免费 GPU 额度用完了",
        `Hugging Face 免费账号每天约有 5 分钟 ZeroGPU 时长，这次请求超出了剩余额度${again ? `，大约 ${again.trim()} 后恢复` : "，额度在第一次使用的 24 小时后重置"}。可以缩短视频时长、改用智谱 CogVideoX-Flash，或升级 HF PRO（每天 40 分钟）。\n原始信息：${raw}`,
      );
    }
    if (status === 401 || status === 403 || /unauthori[sz]ed|invalid (token|credentials)|401/i.test(msg)) {
      return vErr("key", "令牌无效", `Hugging Face 不认这个令牌（${status || "401"}），可能已过期、被删除或复制时少了字符。到「设置 → 视频服务」重新添加。\n原始信息：${raw}`);
    }
    if (status === 404 || /not found in space|找不到 Space|no such space/i.test(msg)) {
      return vErr("space", "Space 不可用", `${raw}\n可以在「设置 → 视频服务」换回预设的 Space。`);
    }
    if (status === 429) return vErr("busy", "请求太频繁", `Hugging Face 限流了，稍等一会儿再试。\n原始信息：${raw}`);
    if (status === 503 || /sleeping|building|runtime error|用不了/i.test(msg)) return vErr("space", "Space 暂时用不了", `${raw}\n可以稍后再试，或换一个 Space。`);
    if (status === 400) return vErr("bad", "参数有问题", raw);
    if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(msg)) return vErr("network", "连不上 Hugging Face", `服务端连不上 Hugging Face：${raw}`);
    return vErr("unknown", "生成失败", raw || "Space 没有说明原因。");
  }
  // 智谱
  if (code === "1301") return vErr("safety", "内容没有通过审核", "智谱认为描述或参考图可能包含敏感内容，换个说法再试。");
  if (code === "1113") return vErr("quota", "智谱账户不可用", `智谱提示账户欠费或额度不足（1113）。CogVideoX-Flash 本身免费，可以到智谱控制台看看账户状态。\n原始信息：${raw}`);
  if (status === 401 || /^100[0-4]$/.test(code || "")) return vErr("key", "API Key 无效", `智谱不认这个 Key（${code || status}），到「设置 → 视频服务」重新添加。\n原始信息：${raw}`);
  if (code === "1302" || code === "1305" || status === 429) return vErr("busy", "请求太多了", `智谱限流或当前访问量过大（${code || status}），稍后再试。`);
  if (status === 400) return vErr("bad", "参数有问题", raw);
  if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(msg)) return vErr("network", "连不上智谱", `服务端连不上智谱：${raw}`);
  return vErr("unknown", "生成失败", raw || "智谱没有说明原因。");
}

// ===== 提交 =====
export interface SubmitBody {
  prompt?: string;
  mode?: VideoMode;
  provider?: VideoProvider;
  space?: string;
  duration?: number;
  aspect?: VideoAspect;
  images?: string[];
  convId?: string;
  msgId?: string;
}

export class BadRequest extends Error {}

export async function createTask(b: SubmitBody): Promise<{ task: TaskRec; run?: () => Promise<void> }> {
  const prompt = (b.prompt || "").trim();
  const mode = VIDEO_MODES.find((m) => m.id === b.mode);
  if (!mode) throw new BadRequest("视频模式不对");
  const cfg = await getVideoConfig();
  const provider: VideoProvider = b.provider === "hf" || b.provider === "zhipu" ? b.provider : cfg.provider;
  const pv = VIDEO_PROVIDERS.find((p) => p.id === provider)!;
  if (!pv.modes.includes(mode.id)) throw new BadRequest(`${pv.short} 不支持「${mode.name}」`);
  const images = (Array.isArray(b.images) ? b.images : []).filter((u) => typeof u === "string" && u.startsWith("/api/files/")).slice(0, 2);
  if (images.length < mode.images) throw new BadRequest(mode.images === 2 ? "首尾帧要两张图：开头一张、结尾一张" : "图生视频要先放一张图");
  if (!prompt && mode.id === "t2v") throw new BadRequest("请写一句画面描述");
  if (prompt.length > 1500) throw new BadRequest("描述太长了，控制在 1500 字以内");
  const aspect: VideoAspect | undefined = b.aspect === "16:9" || b.aspect === "9:16" || b.aspect === "1:1" ? b.aspect : undefined;

  const t: TaskRec = {
    id: randomId(16).replace(/[^A-Za-z0-9_-]/g, "x"),
    status: "queued",
    phase: "queue",
    provider,
    mode: mode.id,
    prompt,
    aspect,
    images: images.slice(0, mode.images),
    convId: typeof b.convId === "string" ? b.convId.slice(0, 64) : undefined,
    msgId: typeof b.msgId === "string" ? b.msgId.slice(0, 64) : undefined,
    label: "",
    startedAt: Date.now(),
    updatedAt: Date.now(),
    eta: ZHIPU_ETA,
  };

  if (provider === "hf") {
    let choice: HfChoice;
    if (typeof b.space === "string" && b.space) {
      const { validSpaceChoice } = await import("./config");
      const v = validSpaceChoice(b.space, mode.id);
      if (!v) throw new BadRequest("Space 名称格式不对，应为 owner/name");
      choice = parseHfChoice(v, mode.id);
    } else choice = parseHfChoice(cfg.hfSpace[mode.id], mode.id);
    t.space = choice.space;
    t.tool = choice.tool;
    t.presetId = choice.preset?.id;
    const max = choice.preset?.maxSec ?? 10;
    const def = choice.preset?.defSec ?? 3;
    const d = Number(b.duration);
    t.duration = Math.round(Math.min(max, Math.max(1, Number.isFinite(d) && d > 0 ? d : def)) * 10) / 10;
    t.eta = Math.round((choice.preset?.eta ?? 90) * Math.max(0.7, t.duration / def));
    t.label = `HF · ${choice.space}`;
    const token = await videoKey("hf");
    if (!token) {
      fail(t, classify(Object.assign(new Error("nokey"), { nokey: true }), "hf"));
      await store(t);
      return { task: t };
    }
    t.status = "running";
    await store(t);
    return { task: t, run: () => runHf(t, token) };
  }

  // 智谱：提交很快，直接在这个请求里交出去，拿回对方的任务 id
  t.label = `智谱 · ${ZHIPU_MODEL}`;
  const key = await videoKey("zhipu");
  if (!key) {
    fail(t, classify(Object.assign(new Error("nokey"), { nokey: true }), "zhipu"));
    await store(t);
    return { task: t };
  }
  try {
    let image: string | undefined;
    if (t.images[0]) {
      t.phase = "upload";
      const img = await prepImage(t.images[0], 1600);
      image = `data:${img.mime};base64,${img.data.toString("base64")}`;
    }
    t.upstreamId = await zhipuSubmit(key, { prompt: t.prompt || "让画面自然地动起来", image, aspect });
    t.status = "running";
    t.phase = "generate";
    t.lastPoll = Date.now();
  } catch (e) {
    fail(t, classify(e, "zhipu"));
  }
  await store(t);
  return { task: t };
}

/** 把站内图片转成 JPEG（长边不超过 side），服务商都认 JPEG；顺便拿到宽高 */
async function prepImage(url: string, side: number): Promise<{ data: Buffer; mime: string; w: number; h: number }> {
  const f = await resolveImage(url);
  const sharp = (await import("sharp")).default;
  const img = sharp(Buffer.from(f.data, "base64"), { failOn: "none" }).rotate().resize({ width: side, height: side, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" });
  const { data, info } = await img.jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
  return { data, mime: "image/jpeg", w: info.width, h: info.height };
}

/** 按宽高比算 32 的倍数的尺寸，长边 long */
function dims(w: number, h: number, long: number) {
  const r = w / h;
  const W = r >= 1 ? long : Math.round((long * r) / 32) * 32;
  const H = r >= 1 ? Math.round(long / r / 32) * 32 : long;
  return { w: Math.max(256, W), h: Math.max(256, H) };
}
const ASPECT_DIMS: Record<VideoAspect, { w: number; h: number }> = { "16:9": { w: 768, h: 448 }, "9:16": { w: 448, h: 768 }, "1:1": { w: 512, h: 512 } };

const NEG_ZH = "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走";

/** 预设 Space 的参数（参数名都用 view_parameters 核对过） */
function presetParams(t: TaskRec, imgs: string[], size?: { w: number; h: number }): Record<string, unknown> | null {
  const d = t.duration || 3;
  const prompt = t.prompt || "make this image come alive, cinematic motion, smooth animation";
  switch (t.presetId) {
    case "ltx-t2v": {
      const s = ASPECT_DIMS[t.aspect || "16:9"];
      return { prompt, mode: "text-to-video", duration_ui: d, width_ui: s.w, height_ui: s.h, improve_texture_flag: true, randomize_seed: true };
    }
    case "ltx-i2v": {
      const s = size ? dims(size.w, size.h, 704) : ASPECT_DIMS["16:9"];
      return { prompt, mode: "image-to-video", input_image_filepath: imgs[0], duration_ui: d, width_ui: s.w, height_ui: s.h, improve_texture_flag: true, randomize_seed: true };
    }
    case "wan-i2v":
      return { input_image: imgs[0], prompt, duration_seconds: d, steps: 6, negative_prompt: NEG_ZH, randomize_seed: true };
    case "wan-flf":
      return { start_image_pil: imgs[0], end_image_pil: imgs[1], prompt, duration_seconds: d, steps: 8, negative_prompt: NEG_ZH, randomize_seed: true };
  }
  return null;
}

/**
 * 自填的 Space：先 view_parameters 读参数表（不耗额度），按名字认出提示词、图片、时长、模式这几个常见参数。
 * 认不出的参数不传，用 Space 自己的默认值。
 */
async function customParams(token: string, t: TaskRec, imgs: string[]): Promise<{ tool: string; params: Record<string, unknown> }> {
  const v = await viewParameters(token, t.space!, t.tool);
  const ps: SpaceParam[] = v.params;
  const out: Record<string, unknown> = {};
  const find = (re: RegExp, pred: (p: SpaceParam) => boolean = () => true) => ps.find((p) => re.test(p.name) && pred(p));
  const prompt = ps.find((p) => p.name === "prompt") || find(/prompt|text|caption/i, (p) => !/neg/i.test(p.name) && !p.file);
  if (prompt) out[prompt.name] = t.prompt || "cinematic motion, smooth animation";
  const files = ps.filter((p) => p.file && /image|img|frame|pil|photo|picture/i.test(p.name));
  if (imgs.length) {
    const first = files.find((p) => /start|first|input|^image|init/i.test(p.name) && !/end|last/i.test(p.name)) || files[0];
    if (first) out[first.name] = imgs[0];
    if (imgs[1]) {
      const last = files.find((p) => /end|last|final/i.test(p.name) && p !== first);
      if (last) out[last.name] = imgs[1];
    }
    if (!first) throw new HfError(`这个 Space 的工具 ${v.tool} 没有图片参数，换「文生视频」或换一个 Space`, 400);
  }
  const dur = find(/duration|seconds|length/i, (p) => /number|integer/i.test(p.type));
  if (dur) out[dur.name] = t.duration;
  const modeP = ps.find((p) => p.enumValues?.some((x) => /text-to-video|image-to-video/i.test(x)));
  if (modeP) out[modeP.name] = imgs.length ? modeP.enumValues!.find((x) => /image-to-video/i.test(x)) : modeP.enumValues!.find((x) => /text-to-video/i.test(x));
  const rnd = ps.find((p) => p.name === "randomize_seed");
  if (rnd) out[rnd.name] = true;
  return { tool: v.tool, params: out };
}

async function runHf(t: TaskRec, token: string) {
  const deadline = t.startedAt + HF_BUDGET_MS;
  // 进度最多 2 秒落一次库；节流期间来的更新在窗口结束时补存（不丢最后一次状态）
  let lastSave = 0;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  const saveSoon = (force = false) => {
    const wait = 2000 - (Date.now() - lastSave);
    if (!force && wait > 0) {
      trailing ??= setTimeout(() => {
        trailing = null;
        if (t.status === "running") saveSoon(true);
      }, wait);
      return;
    }
    if (trailing) clearTimeout(trailing);
    trailing = null;
    lastSave = Date.now();
    void store(t).catch(() => {});
  };
  try {
    // 1. 参考图交给 Space（Space 只能读公网地址，本站的图先传到 Space 自己的临时目录）
    const imgs: string[] = [];
    let size: { w: number; h: number } | undefined;
    if (t.images.length) {
      t.phase = "upload";
      saveSoon(true);
      for (const u of t.images) {
        const img = await prepImage(u, 1280);
        size ??= { w: img.w, h: img.h };
        imgs.push(await uploadToSpace(token, t.space!, img, AbortSignal.timeout(Math.max(5000, Math.min(60000, deadline - Date.now())))));
      }
    }
    let tool = t.tool;
    let params = presetParams(t, imgs, size);
    if (!params) {
      const c = await customParams(token, t, imgs);
      tool = c.tool;
      params = c.params;
    }
    t.phase = "queue";
    saveSoon(true);
    // 2. 调 Space。CloudFront 偶尔在长调用上提前给 504，时间还够的话重试一次
    let r;
    for (let attempt = 0; ; attempt++) {
      try {
        r = await invokeSpace(token, t.space!, tool, params, {
          signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
          onProgress: (p) => {
            const m = p.message || "";
            const q = /queue|排队/i.test(m) ? /(\d+)\s*(?:\/|of)\s*\d+/.exec(m)?.[1] || /position\D*(\d+)/i.exec(m)?.[1] : undefined;
            if (q) {
              t.phase = "queue";
              t.queue = Number(q);
            } else {
              t.phase = "generate";
              t.queue = undefined;
              if (p.total && p.total > 0 && Number.isFinite(p.progress)) t.progress = Math.min(1, Math.max(0, p.progress! / p.total));
            }
            saveSoon();
          },
        });
        break;
      } catch (e) {
        const st = (e as HfError).status;
        const gateway = st === 504 || st === 502 || /cloudfront|gateway time-?out/i.test(String((e as Error).message));
        if (attempt === 0 && gateway && deadline - Date.now() > 120_000) {
          t.phase = "queue";
          saveSoon(true);
          continue;
        }
        throw e;
      }
    }
    const url = findVideoUrl(r);
    if (!url) throw new HfError("Space 返回了结果，但里面没有视频地址：" + JSON.stringify(r.content || []).slice(0, 200), 502);
    // 3. 转存（*.hf.space 的文件过一阵会被清掉，国内也不一定能直连）
    t.phase = "save";
    saveSoon(true);
    const saved = await persistRemoteVideo(url);
    await complete(t, { url: saved.url, temp: saved.temp, poster: t.images[0] ? localImageUrl(t.images[0]) : undefined });
  } catch (e) {
    console.error("[prism] HF 视频生成失败", (e as Error)?.message || e);
    fail(t, classify(e, "hf"));
    await finish(t);
  }
}

function fail(t: TaskRec, err: VideoError) {
  t.status = "failed";
  t.error = err;
  t.latencyMs = Date.now() - t.startedAt;
  t.phase = undefined;
}

async function complete(t: TaskRec, result: VideoResult) {
  t.status = "done";
  t.result = result;
  t.phase = undefined;
  t.progress = 1;
  t.latencyMs = Date.now() - t.startedAt;
  await addGallery([{ kind: "video", url: result.url, poster: result.poster, prompt: t.prompt || "（无描述）", model: t.label, convId: t.convId }]).catch((e) =>
    console.error("[prism] 视频写入图库失败", e),
  );
  await finish(t);
}

/** 落库、写日志、把结果写回对话里那条消息（消息还在等结果时才写，避免覆盖用户之后的操作） */
async function finish(t: TaskRec) {
  await store(t);
  await addLog({
    source: "ui-video",
    model: t.label,
    channel: VIDEO_PROVIDERS.find((p) => p.id === t.provider)?.short,
    ok: t.status === "done",
    latencyMs: t.latencyMs || 0,
    attempts: 1,
    error: t.error ? `${t.error.title}：${t.error.message}`.slice(0, 500) : undefined,
  }).catch(() => {});
  if (t.convId && t.msgId) {
    await patchConversationMessage(t.convId, t.msgId, (m) => {
      if (!m.pending || m.task?.id !== t.id) return null;
      return t.status === "done"
        ? { ...m, pending: false, task: undefined, video: t.result, latencyMs: t.latencyMs, channel: t.space || ZHIPU_MODEL }
        : { ...m, pending: false, task: undefined, error: { title: t.error!.title, message: t.error!.message, kind: t.error!.kind, fix: errFix(t.error!.kind) }, latencyMs: t.latencyMs };
    }).catch((e) => console.error("[prism] 视频结果写回对话失败", e));
  }
}

export function errFix(kind: VideoErrorKind): "video" | undefined {
  return kind === "key" || kind === "nokey" || kind === "space" ? "video" : undefined;
}

// ===== 查状态 =====
export async function getTask(id: string): Promise<VideoTaskView | null> {
  const t = await load(id);
  if (!t) return null;
  if (t.status === "queued" || t.status === "running") {
    // HF：提交接口的函数最多跑 300 秒；过了这么久还没结果，说明那次调用已经被掐断
    if (t.provider === "hf" && Date.now() - t.startedAt > HF_BUDGET_MS + 40_000) {
      fail(t, classify(Object.assign(new Error("timeout"), { name: "TimeoutError" }), "hf"));
      await finish(t);
    } else if (t.provider === "zhipu" && t.upstreamId) {
      await pollZhipu(t);
    }
  }
  return toView(t);
}

const ZHIPU_MAX_MS = 15 * 60_000;

async function pollZhipu(t: TaskRec) {
  const now = Date.now();
  if (t.finalizing && now - t.finalizing < 90_000) return; // 别的请求正在转存
  if (t.lastPoll && now - t.lastPoll < 2500) return;
  t.lastPoll = now;
  const key = await videoKey("zhipu");
  if (!key) {
    fail(t, classify(Object.assign(new Error("nokey"), { nokey: true }), "zhipu"));
    return finish(t);
  }
  let r;
  try {
    r = await zhipuQuery(key, t.upstreamId!);
  } catch (e) {
    const z = e as ZhipuError;
    if (z.status === 401 || /^100[0-4]$/.test(z.code || "")) {
      fail(t, classify(e, "zhipu"));
      return finish(t);
    }
    // 查询偶尔失败不算任务失败，下次再查
    await store(t);
    return;
  }
  if (r.status === "PROCESSING") {
    if (now - t.startedAt > ZHIPU_MAX_MS) {
      fail(t, classify(Object.assign(new Error("timeout"), { name: "TimeoutError" }), "zhipu"));
      return finish(t);
    }
    await store(t);
    return;
  }
  if (r.status === "FAIL" || !r.url) {
    fail(t, vErr("unknown", "生成失败", r.status === "FAIL" ? "智谱返回任务失败，没有说明原因。可以换个描述再试。" : "智谱说成功了，但没有返回视频地址。"));
    return finish(t);
  }
  t.finalizing = now;
  t.phase = "save";
  await store(t);
  const [saved, poster] = await Promise.all([persistRemoteVideo(r.url), r.cover ? persistRemotePoster(r.cover) : Promise.resolve(undefined)]);
  await complete(t, { url: saved.url, temp: saved.temp, poster: poster || (t.images[0] ? localImageUrl(t.images[0]) : undefined) });
}
