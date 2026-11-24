import type { ChannelType } from "../types";

/**
 * 按模型决定画图页能选的参数（参考 haru 的 imageProfile，只保留 Prism 后端真能传到上游的）：
 * - 尺寸原样传给 OpenAI 兼容接口；Gemini 渠道只认 1:1 / 2:3 / 3:2（服务端按宽高比换算）
 * - 质量只对 gpt-image（low/medium/high）和 dall-e-3（标准/HD）生效
 * - 张数：服务端最多 4 张；dall-e-3、Gemini 会拆成多次请求
 */
export interface ImageProfile {
  sizes: string[];
  qualities: { v: string; l: string }[];
  maxN: number;
  hint: string;
}

const GPT_Q = [
  { v: "", l: "默认" },
  { v: "low", l: "低（快）" },
  { v: "medium", l: "中" },
  { v: "high", l: "高" },
];

export function imageProfile(model: string, upstream: string | undefined, type: ChannelType | undefined): ImageProfile {
  const m = `${upstream || ""} ${model}`.toLowerCase();
  const P: ImageProfile = { sizes: [], qualities: [], maxN: 4, hint: "" };
  if (type === "gemini") return { ...P, sizes: ["auto", "1024x1024", "1024x1536", "1536x1024"], hint: "Gemini 出图只认 1:1、2:3、3:2 三种比例；多张会分几次请求。" };
  if (/dall-e-3/.test(m))
    return {
      ...P,
      sizes: ["1024x1024", "1024x1792", "1792x1024"],
      qualities: [
        { v: "", l: "标准" },
        { v: "high", l: "HD" },
      ],
      hint: "DALL·E 3 每次只出 1 张，选多张会并发请求。",
    };
  if (/dall-e-2/.test(m)) return { ...P, sizes: ["1024x1024", "512x512", "256x256"] };
  if (/gpt-image|chatgpt-image/.test(m)) return { ...P, sizes: ["auto", "1024x1024", "1024x1536", "1536x1024"], qualities: GPT_Q, hint: "GPT Image 不支持反向词，想避开的内容写进描述里。质量越高越慢。" };
  if (/seedream|seededit|doubao/.test(m)) return { ...P, sizes: ["2048x2048", "1728x2304", "2304x1728", "1440x2560", "2560x1440", "1664x2496", "2496x1664", "1024x1024"], hint: "豆包 Seedream：支持 2K 尺寸。" };
  if (/qwen-image/.test(m)) return { ...P, sizes: ["1328x1328", "1140x1472", "1472x1140", "928x1664", "1664x928", "1056x1584", "1584x1056"] };
  if (/kolors/.test(m)) return { ...P, sizes: ["1024x1024", "768x1024", "960x1280", "720x1280", "720x1440"] };
  if (/flux/.test(m)) return { ...P, sizes: ["1024x1024", "1024x1536", "1536x1024", "768x1344", "1344x768"], hint: "FLUX 不使用反向词。" };
  if (/imagen/.test(m)) return { ...P, sizes: ["1024x1024", "1024x1536", "1536x1024"] };
  if (/gemini|banana|image-preview/.test(m)) return { ...P, sizes: ["auto", "1024x1024", "1024x1536", "1536x1024"], hint: "比例由中转站转给模型，不一定严格遵守。" };
  return { ...P, sizes: ["auto", "1024x1024", "1024x1536", "1536x1024", "1024x1792", "1792x1024", "512x512"], hint: "" };
}

const NAMED: [string, number][] = [
  ["1:1", 1],
  ["4:5", 0.8],
  ["3:4", 0.75],
  ["2:3", 2 / 3],
  ["9:16", 9 / 16],
  ["1:2", 0.5],
  ["5:4", 1.25],
  ["4:3", 4 / 3],
  ["3:2", 1.5],
  ["16:9", 16 / 9],
  ["2:1", 2],
];

function parse(size: string): number | null {
  const m = /^(\d+)x(\d+)$/.exec(size);
  return m ? Number(m[1]) / Number(m[2]) : null;
}
function parseRatio(r: string): number | null {
  const m = /^(\d+):(\d+)$/.exec(r);
  return m ? Number(m[1]) / Number(m[2]) : null;
}

/** 1024x1536 → 「2:3 竖图」 */
export function sizeLabel(size: string): string {
  if (size === "auto") return "自动";
  const r = parse(size);
  if (!r) return size;
  let best = "";
  let d = Infinity;
  for (const [n, v] of NAMED) {
    const x = Math.abs(Math.log(v) - Math.log(r));
    if (x < d) {
      d = x;
      best = n;
    }
  }
  return `${best} ${r === 1 ? "方图" : r < 1 ? "竖图" : "横图"}`;
}

/** 从提示词带来的建议比例（如 2:3），在当前模型能选的尺寸里挑最接近的 */
export function sizeForRatio(ratio: string | undefined, sizes: string[]): string | null {
  const r = ratio ? parseRatio(ratio) : null;
  if (!r) return null;
  let best: string | null = null;
  let d = Infinity;
  for (const s of sizes) {
    const v = parse(s);
    if (!v) continue;
    const x = Math.abs(Math.log(v) - Math.log(r));
    if (x < d - 1e-9) {
      d = x;
      best = s;
    }
  }
  return best;
}

/** 尺寸的宽高比（给结果占位用，没有就当方图） */
export function aspectOfSize(size?: string): string {
  const m = /^(\d+)x(\d+)$/.exec(size || "");
  return m ? `${m[1]} / ${m[2]}` : "1 / 1";
}
