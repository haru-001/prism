/**
 * 棱音的形象：八套服装 × 七个状态的立绘。
 *
 * 图片都在 public/img/rinne/ 下，同域加载，文件名带内容哈希（可以长期缓存）。
 * 每套服装的每个状态是单独设计的动作，所以画布比例和连接点也按「服装 + 状态」各记一份，
 * 由 scripts/rinne/export_stage3.py 生成到 lib/rinne-assets.json。
 * 所有画布高度相同、人物身高一致，换装时人物大小不跳；舞台宽度跟着当前这张图的比例走。
 */
import assets from "./rinne-assets.json";

export type Mood = "welcome" | "guide" | "thinking" | "success" | "error" | "imaging" | "waiting";
export type OutfitId = "suit" | "gown" | "summer" | "home" | "trench" | "qipao" | "bridal" | "sport";
export type RinneMotion = "system" | "on" | "off";
/** 舞台尺寸档：lg 430px、md 340px、sm 290px（手机 300 / 270 / 240），xs 是 toast（96，手机 84），bar 是顶部提醒条（84，手机 64） */
export type StageSize = "lg" | "md" | "sm" | "xs" | "bar";

export const MOODS: Mood[] = ["welcome", "guide", "thinking", "success", "error", "imaging", "waiting"];

export const OUTFITS: { id: OutfitId; name: string; note: string }[] = [
  { id: "suit", name: "干练职业装", note: "默认" },
  { id: "gown", name: "晚会礼服", note: "正式场合" },
  { id: "summer", name: "清爽夏季", note: "短上衣 · 牛仔短裤" },
  { id: "home", name: "居家睡衣", note: "深夜加班" },
  { id: "trench", name: "秋日风衣", note: "出门在外" },
  { id: "qipao", name: "新中式", note: "节日" },
  { id: "bridal", name: "婚纱", note: "蕾丝露背" },
  { id: "sport", name: "运动套装", note: "跑步短裤" },
];

export const DEFAULT_OUTFIT: OutfitId = "suit";

export function isOutfit(v: unknown): v is OutfitId {
  return typeof v === "string" && OUTFITS.some((o) => o.id === v);
}
export function isMotion(v: unknown): v is RinneMotion {
  return v === "system" || v === "on" || v === "off";
}

/** 每套服装每个状态的动作说明，做图片 alt */
const ALT: Record<OutfitId, Record<Mood, string>> = {
  suit: { welcome: "挥手打招呼", guide: "摊手示意", thinking: "低头看平板", success: "比 OK", error: "拿着手机示意", imaging: "拿着相机", waiting: "抱着平板看手表" },
  gown: { welcome: "举杯提裙致意", guide: "掌心向上引向一侧", thinking: "手指轻点下巴", success: "轻轻鼓掌", error: "拿着手机略带歉意", imaging: "拿着卡片相机", waiting: "看腕表静候" },
  summer: { welcome: "双手挥舞", guide: "蹦一步回头指路", thinking: "咬着吸管看手机", success: "比耶", error: "双手合十道歉", imaging: "举着拍立得", waiting: "坐着扇扇子" },
  home: { welcome: "抱着靠垫挥手", guide: "拿着平板示意", thinking: "窝在懒人沙发看电脑", success: "坐着伸懒腰", error: "裹着毯子拿手机", imaging: "坐着用平板画画", waiting: "端着茶杯打哈欠" },
  trench: { welcome: "一手插兜一手挥", guide: "侧身回头指路", thinking: "边走边看手机", success: "竖大拇指", error: "把手机递出来给你看", imaging: "拿着胶片相机", waiting: "撑着透明伞等人" },
  qipao: { welcome: "作揖行礼", guide: "团扇指引", thinking: "托腮执笔", success: "浅笑点头", error: "轻掩口略带歉意", imaging: "执毛笔作画", waiting: "捧着茶盏静候" },
  bridal: { welcome: "捧花微笑挥手", guide: "转身回头示意", thinking: "低头看誓词卡", success: "抛捧花", error: "拿着手机略带歉意", imaging: "举着相框", waiting: "侧身整理头纱" },
  sport: { welcome: "边跑边挥手", guide: "吹哨指方向", thinking: "拉伸时看运动手表", success: "跳起来握拳", error: "擦汗看手机", imaging: "举着运动相机", waiting: "坐在台阶上喝水" },
};
export function moodAlt(o: OutfitId, m: Mood) {
  return "棱音" + ALT[o][m];
}

type MoodMeta = { ar: number; hx: number; hy: number };
/** f：WebP 的哈希 [舞台1x, 舞台2x, 小立绘1x, 小立绘2x, 头像1x, 头像2x]；a：AVIF 的哈希 [舞台1x, 舞台2x, 小立绘1x, 小立绘2x] */
type Entry = MoodMeta & { bx: number; f: string[]; a: string[] };
const A = assets as unknown as {
  tiers: { stage: [number, number]; mini: [number, number] };
  outfits: Record<OutfitId, Record<Mood, Entry> & { thumb: string[] }>;
};

/** 这套服装这个状态的画布比例（宽/高）和连接点（占宽、高的比例） */
export function moodMeta(o: OutfitId, m: Mood): MoodMeta {
  const e = A.outfits[o][m];
  return { ar: e.ar, hx: e.hx, hy: e.hy };
}

/**
 * 换装时舞台不动：同一状态下八套服装共用一个舞台宽度（取最宽那张），
 * 图片在舞台里横向偏移，让头部中心落在同一条竖线上（八套头部位置的平均值，偏移不会让图片出舞台）。
 * 所有状态里最低的连接点（hyMax）给居中排版的页面预留高度，换装或换状态时整块不上下跳。
 */
const OUTFIT_IDS = Object.keys(A.outfits) as OutfitId[];
const MOOD_IDS: Mood[] = ["welcome", "guide", "thinking", "success", "error", "imaging", "waiting"];
const STAGE_FIT = Object.fromEntries(
  MOOD_IDS.map((m) => {
    const es = OUTFIT_IDS.map((o) => A.outfits[o][m]);
    const arw = Math.max(...es.map((e) => e.ar));
    // 每张图居中放时头部的位置（以舞台高度为单位），取平均作目标
    const head = es.reduce((t, e) => t + (arw - e.ar) / 2 + e.ar * e.bx, 0) / es.length;
    return [m, { arw, head }];
  }),
) as Record<Mood, { arw: number; head: number }>;
export const HY_MAX = Math.max(...OUTFIT_IDS.flatMap((o) => MOOD_IDS.map((m) => A.outfits[o][m].hy)));

/** 舞台宽度（以显示高度为单位）和这张图在舞台里的横向偏移（同样以显示高度为单位） */
export function stageFit(o: OutfitId, m: Mood): { arw: number; ox: number } {
  const e = A.outfits[o][m];
  const { arw, head } = STAGE_FIT[m];
  const ox = Math.min(Math.max(head - e.ar * e.bx, 0), arw - e.ar);
  return { arw, ox: Math.round(ox * 10000) / 10000 };
}

/** 各尺寸档的显示高度：[桌面, 手机(≤560px)] */
export const STAGE_H: Record<StageSize, [number, number]> = {
  lg: [430, 300],
  md: [340, 270],
  sm: [290, 240],
  xs: [96, 84],
  bar: [84, 64],
};

/** 图片文件的高度档（由 export_stage3.py 写进 rinne-assets.json）：舞台 430 / 860，小立绘 100 / 250 */
const STAGE_FILE_H = A.tiers.stage;
const MINI_FILE_H = A.tiers.mini;

function url(o: OutfitId, m: Mood, suffix: string, i: number) {
  return `/img/rinne/${o}/${m}${suffix}.${A.outfits[o][m].f[i]}.webp`;
}
function avifUrl(o: OutfitId, m: Mood, suffix: string, i: number) {
  return `/img/rinne/${o}/${m}${suffix}.${A.outfits[o][m].a[i]}.avif`;
}

export interface FigureSrc {
  src: string;
  srcSet: string;
  /** 同样两档的 AVIF，放在 <picture><source type="image/avif"> 里，不支持的浏览器用 WebP */
  avifSrcSet: string;
  sizes: string;
  /** 显示宽高（桌面档），给 width/height 属性用，避免布局跳动 */
  width: number;
  height: number;
}

/**
 * 立绘图片地址。舞台大图（lg/md/sm）用 430/860 高的两档，toast 和提醒条用 100/250 高的小立绘，
 * 不拿大图缩小显示。sizes 按这一档的显示宽度写，浏览器按屏幕像素密度选 1x 或 2x。
 * mobileH 用来覆盖手机上的显示高度（比如引导页手机上是 262px）。
 */
export function figureSrc(o: OutfitId, m: Mood, size: StageSize, mobileH?: number): FigureSrc {
  const { ar } = A.outfits[o][m];
  const mini = size === "xs" || size === "bar";
  const fileH = mini ? MINI_FILE_H : STAGE_FILE_H;
  const suf = mini ? "-sm" : "";
  const [hd, hm0] = STAGE_H[size];
  const hm = mobileH ?? hm0;
  const w1 = Math.round(fileH[0] * ar);
  const w2 = Math.round(fileH[1] * ar);
  const i0 = mini ? 2 : 0;
  return {
    src: url(o, m, suf, i0),
    srcSet: `${url(o, m, suf, i0)} ${w1}w, ${url(o, m, suf + "-2x", i0 + 1)} ${w2}w`,
    avifSrcSet: `${avifUrl(o, m, suf, i0)} ${w1}w, ${avifUrl(o, m, suf + "-2x", i0 + 1)} ${w2}w`,
    sizes: `(max-width: 560px) ${Math.round(hm * ar)}px, ${Math.round(hd * ar)}px`,
    width: Math.round(hd * ar),
    height: hd,
  };
}

/** 圆形头像（64 / 128） */
export function avatarSrc(o: OutfitId, m: Mood = "welcome") {
  return { src: url(o, m, "-avatar", 4), srcSet: `${url(o, m, "-avatar", 4)} 1x, ${url(o, m, "-avatar-2x", 5)} 2x` };
}

/** 衣柜缩略图（120×160 / 240×320） */
export function thumbSrc(o: OutfitId) {
  const t = A.outfits[o].thumb;
  return { src: `/img/rinne/wardrobe/${o}.${t[0]}.webp`, srcSet: `/img/rinne/wardrobe/${o}.${t[0]}.webp 1x, /img/rinne/wardrobe/${o}-2x.${t[1]}.webp 2x` };
}

/** 存在 cookie 里的形象设置（登录页、引导页还没有设置可读时用），格式 outfit|motion|show */
export const RINNE_COOKIE = "prism_rinne";
export interface RinnePrefs {
  outfit: OutfitId;
  motion: RinneMotion;
  show: boolean;
}
export const DEFAULT_PREFS: RinnePrefs = { outfit: DEFAULT_OUTFIT, motion: "system", show: true };
export function parsePrefs(v: string | undefined | null): RinnePrefs {
  if (!v) return DEFAULT_PREFS;
  const [o, m, s] = decodeURIComponent(v).split("|");
  return { outfit: isOutfit(o) ? o : DEFAULT_OUTFIT, motion: isMotion(m) ? m : "system", show: s !== "0" };
}
export function prefsCookie(p: RinnePrefs) {
  return `${p.outfit}|${p.motion}|${p.show ? 1 : 0}`;
}
