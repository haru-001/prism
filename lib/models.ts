import type { Cap, ChannelType } from "./types";

/** 按模型名猜能力标签，渠道里可以手动改 */
export function guessCaps(model: string): Cap[] {
  const m = model.toLowerCase();
  if (
    /(gpt-image|dall-e|imagen|flux|stable-diffusion|sdxl|\bsd3|midjourney|seedream|kolors|cogview|ideogram|recraft|hunyuan-image|wanx|qwen-image|-image-preview|flash-image|image-generation|nano-banana)/.test(
      m,
    )
  )
    return ["image"];
  const caps: Cap[] = ["chat"];
  if (
    /(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|gpt-5|chatgpt-4o|\bo1\b|o1-2|\bo3|\bo4|claude-3|claude-(sonnet|opus|haiku)|claude-.*-4|gemini|vision|-vl|vl-|qwen-vl|qvq|glm-4v|glm-4\.5v|pixtral|llava|grok-.*vision|grok-4|kimi-.*vision|doubao.*vision|step-1v|internvl|minicpm-v|llama-4|gemma-3)/.test(
      m,
    )
  )
    caps.push("vision");
  return caps;
}

const POPULAR = [
  /^gpt-5(\.\d)?(-mini)?$/,
  /^gpt-4o(-mini)?$/,
  /^gpt-4\.1(-mini)?$/,
  /^o3$/,
  /^o4-mini$/,
  /^gpt-image-1(\.\d|-mini)?$/,
  /^dall-e-3$/,
  /^claude-(sonnet|opus)-4(-\d)?(-\d+)?(-latest)?$/,
  /^claude-(sonnet|opus|haiku)-4-\d/,
  /^claude-3-[57]-sonnet-latest$/,
  /^gemini-2\.5-(pro|flash)$/,
  /^gemini-\d(\.\d)?-(pro|flash)(-preview)?$/,
  /^gemini-2\.5-flash-image(-preview)?$/,
  /^deepseek-(chat|reasoner)$/,
  /^deepseek-v3/,
  /^qwen-(max|plus)(-latest)?$/,
  /^kimi-k2/,
  /^glm-4\.[56]$/,
];

/** 「常用」模型：获取模型时自动勾上 */
export function pickPopular(models: string[]): string[] {
  const hit = models.filter((m) => POPULAR.some((r) => r.test(m.toLowerCase().replace(/^models\//, ""))));
  if (hit.length) return hit.slice(0, 12);
  // 中转站的模型名奇奇怪怪，数量不多就全勾
  return models.length <= 8 ? models : [];
}

export interface Brand {
  letter: string;
  color: string;
}

/** 模型头像：厂商色 + 字母 */
export function brandOf(model?: string, type?: ChannelType): Brand {
  const m = (model || "").toLowerCase();
  if (/claude/.test(m)) return { letter: "C", color: "#d97757" };
  if (/gemini|imagen|gemma|nano-banana/.test(m)) return { letter: "G", color: "#4285f4" };
  if (/deepseek/.test(m)) return { letter: "D", color: "#4d6bfe" };
  if (/qwen|qvq|wanx/.test(m)) return { letter: "Q", color: "#615ced" };
  if (/grok/.test(m)) return { letter: "X", color: "#111111" };
  if (/kimi|moonshot/.test(m)) return { letter: "K", color: "#1f1f1f" };
  if (/glm|cogview/.test(m)) return { letter: "Z", color: "#3859ff" };
  if (/llama/.test(m)) return { letter: "M", color: "#0866ff" };
  if (/mistral|pixtral/.test(m)) return { letter: "M", color: "#fa520f" };
  if (/doubao|seedream|seed/.test(m)) return { letter: "D", color: "#3c6cf6" };
  if (/flux/.test(m)) return { letter: "F", color: "#222222" };
  if (/gpt|^o\d|dall-e|chatgpt|whisper|tts|davinci/.test(m)) return { letter: "O", color: "#10a37f" };
  if (type === "claude") return { letter: "C", color: "#d97757" };
  if (type === "gemini") return { letter: "G", color: "#4285f4" };
  if (type === "openai" || type === "azure") return { letter: "O", color: "#10a37f" };
  return { letter: (model || "?").replace(/^[^a-z0-9]+/i, "").charAt(0).toUpperCase() || "?", color: "#7c5cff" };
}

export const CHANNEL_TYPES: { type: ChannelType; label: string; sub: string; base: string; letter: string; color: string }[] = [
  { type: "openai", label: "OpenAI", sub: "GPT、生图", base: "https://api.openai.com", letter: "O", color: "#10a37f" },
  { type: "claude", label: "Claude", sub: "Anthropic", base: "https://api.anthropic.com", letter: "C", color: "#d97757" },
  { type: "gemini", label: "Gemini", sub: "Google", base: "https://generativelanguage.googleapis.com", letter: "G", color: "#4285f4" },
  { type: "compatible", label: "OpenAI 兼容", sub: "中转站、自建", base: "", letter: "+", color: "linear-gradient(135deg,#7c5cff,#14b8a6)" },
  { type: "azure", label: "Azure OpenAI", sub: "微软云", base: "https://你的资源名.openai.azure.com", letter: "A", color: "#0078d4" },
];

export function channelTypeInfo(t: ChannelType) {
  return CHANNEL_TYPES.find((x) => x.type === t) || CHANNEL_TYPES[3];
}

/**
 * 规范化 Base URL：结尾带不带 /v1 都行。
 * - OpenAI / 兼容 / Claude：没有版本号路径时补 /v1
 * - Gemini：没有版本号时补 /v1beta
 * - Azure：去掉结尾的 /openai，请求时再拼
 * 用户想保留原样时可以在地址结尾加 #。
 */
export function normalizeBaseUrl(type: ChannelType, raw: string): string {
  let u = (raw || "").trim();
  if (!u) return "";
  if (u.endsWith("#")) return u.slice(0, -1).replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  u = u.replace(/\/+$/, "");
  // 用户误把完整接口路径粘进来
  u = u.replace(/\/(chat\/completions|messages|completions|models|images\/generations)$/i, "");
  if (type === "azure") return u.replace(/\/openai(\/v1)?$/i, "");
  if (type === "gemini") return /\/v\d+(beta|alpha)?\d*$/i.test(u) ? u : u + "/v1beta";
  return /\/v\d+[a-z0-9]*$/i.test(u) || /\/api\/paas\/v4$/i.test(u) ? u : u + "/v1";
}
