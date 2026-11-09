/**
 * 视频生成：浏览器和服务端共用的类型、预设和校验。
 *
 * 两类服务：
 * - Hugging Face 官方 MCP（huggingface.co/mcp）调用开了 MCP 的 ZeroGPU Space，用的是 HF 账号每天的免费 GPU 额度
 * - 智谱 BigModel 的 CogVideoX-Flash（免费模型，异步：提交任务 → 轮询结果）
 * Key 都由用户在「设置 → 视频服务」里添加，AES-256-GCM 加密存在服务端。
 */

export type VideoMode = "t2v" | "i2v" | "flf";
export type VideoProvider = "hf" | "zhipu";
export type VideoAspect = "16:9" | "9:16" | "1:1";

export const VIDEO_MODES: { id: VideoMode; name: string; short: string; images: number }[] = [
  { id: "t2v", name: "文生视频", short: "文生", images: 0 },
  { id: "i2v", name: "图生视频", short: "图生", images: 1 },
  { id: "flf", name: "首尾帧", short: "首尾帧", images: 2 },
];

export const VIDEO_PROVIDERS: { id: VideoProvider; name: string; short: string; free: string; modes: VideoMode[] }[] = [
  { id: "hf", name: "Hugging Face（MCP · ZeroGPU）", short: "Hugging Face", free: "免费账号每天约 5 分钟 GPU 额度", modes: ["t2v", "i2v", "flf"] },
  { id: "zhipu", name: "智谱 CogVideoX-Flash", short: "智谱 CogVideoX-Flash", free: "官方标注免费", modes: ["t2v", "i2v"] },
];

/** Hugging Face 上开了 MCP 的视频 Space 预设（2026-11 用 dynamic_space view_parameters 逐个核对过参数） */
export interface HfPreset {
  id: string;
  mode: VideoMode;
  space: string;
  tool: string;
  name: string;
  note: string;
  /** 预计耗时（秒，含排队，粗估） */
  eta: number;
  /** 时长：默认、上限（秒） */
  defSec: number;
  maxSec: number;
}

export const HF_PRESETS: HfPreset[] = [
  {
    id: "ltx-t2v",
    mode: "t2v",
    space: "Lightricks/ltx-video-distilled",
    tool: "ltx_video_distilled_generate",
    name: "LTX-Video 蒸馏版",
    note: "Lightricks 官方 · 出片快，适合先试效果",
    eta: 45,
    defSec: 3,
    maxSec: 8,
  },
  {
    id: "wan-i2v",
    mode: "i2v",
    space: "zerogpu-aoti/wan2-2-fp8da-aoti-faster",
    tool: "wan2_2_fp8da_aoti_faster_generate_video",
    name: "Wan 2.2 图生视频（Lightning 加速）",
    note: "HF ZeroGPU 团队维护 · 画质好、动作自然",
    eta: 80,
    defSec: 3,
    maxSec: 5,
  },
  {
    id: "ltx-i2v",
    mode: "i2v",
    space: "Lightricks/ltx-video-distilled",
    tool: "ltx_video_distilled_generate_1",
    name: "LTX-Video 图生视频",
    note: "更快、更省额度，画质略逊于 Wan",
    eta: 45,
    defSec: 3,
    maxSec: 8,
  },
  {
    id: "wan-flf",
    mode: "flf",
    space: "mcp-tools/wan-2-2-first-last-frame",
    tool: "wan_2_2_first_last_frame_generate_video",
    name: "Wan 2.2 首尾帧",
    note: "给开头和结尾两张图，补出中间的动作",
    eta: 90,
    defSec: 3,
    maxSec: 5,
  },
];

export const DEFAULT_HF_SPACE: Record<VideoMode, string> = { t2v: "ltx-t2v", i2v: "wan-i2v", flf: "wan-flf" };

/** 智谱 CogVideoX-Flash：时长由服务端决定，不能调 */
export const ZHIPU_MODEL = "cogvideox-flash";
export const ZHIPU_ETA = 60;

/** 用户自己填的 Space 名：owner/name，只允许字母数字和 . _ -，不能有 ..（拼进 URL 前必须过这一关） */
const SPACE_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?$/;
export function isSpaceName(s: unknown): s is string {
  return typeof s === "string" && SPACE_RE.test(s) && !s.includes("..");
}
/** Space 里的工具名（Gradio 函数名）：字母数字下划线，可以留空（用第一个工具） */
export function isToolName(s: unknown): s is string {
  return typeof s === "string" && /^[A-Za-z0-9_]{1,120}$/.test(s);
}

export function presetById(id: string | undefined): HfPreset | undefined {
  return HF_PRESETS.find((p) => p.id === id);
}

/** 某个模式下 HF 用哪个 Space：预设 id，或者 custom:owner/name[#tool] */
export interface HfChoice {
  space: string;
  tool?: string;
  preset?: HfPreset;
}
export function parseHfChoice(v: string | undefined, mode: VideoMode): HfChoice {
  if (v?.startsWith("custom:")) {
    const [space, tool] = v.slice(7).split("#");
    if (isSpaceName(space)) return { space, tool: isToolName(tool) ? tool : undefined };
  }
  const p = presetById(v) && presetById(v)!.mode === mode ? presetById(v)! : presetById(DEFAULT_HF_SPACE[mode])!;
  return { space: p.space, tool: p.tool, preset: p };
}

// ===== 任务 =====
export type VideoStatus = "queued" | "running" | "done" | "failed";
export type VideoErrorKind = "quota" | "timeout" | "key" | "nokey" | "space" | "safety" | "busy" | "bad" | "network" | "unknown";

export interface VideoError {
  kind: VideoErrorKind;
  title: string;
  message: string;
}

export interface VideoResult {
  url: string;
  poster?: string;
  /** 没能转存，是服务商的临时链接（经本站转发），过一段时间会失效 */
  temp?: boolean;
}

/** 浏览器看到的任务状态 */
export interface VideoTaskView {
  id: string;
  status: VideoStatus;
  /** 当前在做什么：上传参考图 / 排队 / 生成 / 转存 */
  phase?: "upload" | "queue" | "generate" | "save";
  /** 排队位置（HF 有时会给） */
  queue?: number;
  /** 0–1 的进度（服务商给了才有） */
  progress?: number;
  startedAt: number;
  /** 预计耗时（秒） */
  eta: number;
  result?: VideoResult;
  error?: VideoError;
  /** 实际用了多久（毫秒） */
  latencyMs?: number;
  label?: string;
}

export function fmtElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
