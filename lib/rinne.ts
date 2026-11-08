/**
 * 棱音的形象：九套服装 × 七个状态的立绘，外加每套服装六张功能页页首像（图库、渠道、用量、令牌、日志、设置）。
 *
 * 图片都在 public/img/rinne/ 下，同域加载，文件名带内容哈希（可以长期缓存）。
 * 每套服装的每个状态是单独设计的动作，所以画布比例和连接点也按「服装 + 状态」各记一份，
 * 由 scripts/rinne/export_stage3.py 生成到 lib/rinne-assets.json。
 * 所有画布高度相同、人物身高一致，换装时人物大小不跳；舞台宽度跟着当前这张图的比例走。
 */
import assets from "./rinne-assets.json";

export type Mood = "welcome" | "guide" | "thinking" | "success" | "error" | "imaging" | "waiting";
export type OutfitId = "suit" | "gown" | "summer" | "home" | "trench" | "qipao" | "bridal" | "sport" | "winter";
export type RinneMotion = "system" | "on" | "off";
/** 舞台尺寸档：lg 430px、md 340px、sm 290px（手机 300 / 270 / 240）全身；xs 是 toast（96，手机 84）、bar 是顶部提醒条（84，手机 64）、chat 是对话里的小场景（150，手机 124），这三档是半身 */
export type StageSize = "lg" | "md" | "sm" | "xs" | "bar" | "chat";
/** 这几档显示半身（头顶到腰）：全身缩到一百来像素就看不清脸了 */
export function isBust(size: StageSize) {
  return size === "xs" || size === "bar" || size === "chat";
}

export const MOODS: Mood[] = ["welcome", "guide", "thinking", "success", "error", "imaging", "waiting"];

export const OUTFITS: { id: OutfitId; name: string; note: string }[] = [
  { id: "suit", name: "干练职业装", note: "真丝衬衫 · 铅笔裙" },
  { id: "gown", name: "晚会礼服", note: "午夜蓝挂脖露背长裙" },
  { id: "summer", name: "清爽夏季", note: "露腰背心 · 高腰牛仔短裤" },
  { id: "home", name: "居家睡衣", note: "缎面吊带 · 深夜加班" },
  { id: "trench", name: "秋日风衣", note: "风衣 · 针织短裙" },
  { id: "qipao", name: "新中式", note: "无袖改良旗袍" },
  { id: "bridal", name: "婚纱", note: "一字肩鱼尾" },
  { id: "sport", name: "运动套装", note: "运动背心 · 紧身短裤" },
  { id: "winter", name: "冬日针织", note: "针织裙 · 过膝靴" },
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
  suit: { welcome: "挥手打招呼", guide: "掌心向上示意", thinking: "看着平板思考", success: "比 OK", error: "举着手机示意", imaging: "拿着相机", waiting: "抱着平板看手表" },
  gown: { welcome: "回眸举杯致意", guide: "掌心向上引向一侧", thinking: "手指轻点下巴", success: "轻轻鼓掌", error: "拿着手机略带歉意", imaging: "拿着卡片相机", waiting: "看腕表静候" },
  summer: { welcome: "双手挥舞", guide: "蹦一步回头指路", thinking: "咬着吸管看手机", success: "敬礼比胜利", error: "双手合十道歉", imaging: "举着拍立得", waiting: "坐在保温箱上扇扇子" },
  home: { welcome: "抱着靠垫挥手", guide: "拿着平板指路", thinking: "窝在懒人沙发看电脑", success: "坐在高脚凳上伸懒腰", error: "披着毯子举手机", imaging: "坐着用平板画画", waiting: "端着茶杯打哈欠" },
  trench: { welcome: "一手插兜一手挥", guide: "回头指路", thinking: "边走边看手机", success: "竖大拇指", error: "把手机递出来给你看", imaging: "拿着胶片相机", waiting: "撑着黑伞等人" },
  qipao: { welcome: "抱拳行礼", guide: "红团扇指引", thinking: "托腮执笔", success: "执折扇浅笑", error: "掩口举手机", imaging: "在折扇上作画", waiting: "捧着茶盏静候" },
  bridal: { welcome: "捧花微笑挥手", guide: "回眸示意", thinking: "低头看誓词卡", success: "抛捧花", error: "举着手机略带歉意", imaging: "举着相框", waiting: "整理头纱" },
  sport: { welcome: "边跑边挥手", guide: "伸手指方向", thinking: "拉伸时看运动手表", success: "跳起来握拳", error: "搭着毛巾举手机", imaging: "举着运动相机", waiting: "坐在跳箱上喝水" },
  winter: { welcome: "端着咖啡挥手", guide: "比着手势指路", thinking: "看手机思考", success: "跳起来比耶", error: "举着手机示意", imaging: "举着拍立得", waiting: "坐在长椅上捧着咖啡" },
};
export function moodAlt(o: OutfitId, m: Mood) {
  return "棱音" + ALT[o][m];
}

type MoodMeta = { ar: number; hx: number; hy: number };
/** f：WebP 的哈希 [舞台1x, 舞台2x, 小立绘1x, 小立绘2x, 头像1x, 头像2x]；a：AVIF 的哈希 [舞台1x, 舞台2x, 小立绘1x, 小立绘2x] */
type Entry = MoodMeta & { bx: number; ty?: number; f: string[]; a: string[] };
type PageEntry = { ar: number; hx: number; hy: number; bx: number; f: string; a: string };
const A = assets as unknown as {
  tiers: { stage: [number, number]; mini: [number, number]; page?: number };
  outfits: Record<OutfitId, Record<Mood, Entry> & { thumb: string[]; pages?: Partial<Record<PageId, PageEntry>> }>;
};

/** 这套服装这个状态的画布比例（宽/高）和连接点（占宽、高的比例） */
export function moodMeta(o: OutfitId, m: Mood): MoodMeta {
  const e = A.outfits[o][m];
  return { ar: e.ar, hx: e.hx, hy: e.hy };
}

/**
 * 换装时舞台不动：同一状态下九套服装共用一个舞台宽度（取最宽那张），
 * 图片在舞台里横向偏移，让头部中心落在同一条竖线上（九套头部位置的平均值，偏移不会让图片出舞台）。
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

/**
 * 半身裁切（toast、提醒条、对话里的小场景）：只显示头顶到腰附近这一段，人物放大到看得清脸和动作。
 * ty：头顶（含帽子、举起的手以外）在画布里的高度比例；bx：头部中心的横向比例。
 * BUST_K：显示窗口占画布高度的比例（站姿约到腰，坐姿约到膝）。
 */
export const BUST_K = 0.44;
export function bustMeta(o: OutfitId, m: Mood): { ty: number; bx: number } {
  const e = A.outfits[o][m];
  return { ty: e.ty ?? 0.02, bx: e.bx };
}

/** 各尺寸档的显示高度：[桌面, 手机(≤560px)] */
export const STAGE_H: Record<StageSize, [number, number]> = {
  lg: [430, 300],
  md: [340, 270],
  sm: [290, 240],
  xs: [96, 84],
  bar: [84, 64],
  chat: [150, 124],
};

/** 图片文件的高度档（由 export_stage3.py 写进 rinne-assets.json）：舞台 430 / 860，小立绘 100 / 250 */
const STAGE_FILE_H = A.tiers.stage;

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
 * 立绘图片地址。全身（lg/md/sm）和半身（xs/bar/chat，放大裁切）都用 430/860 高的两档透明图，
; * sizes 按这一档的显示宽度写，浏览器按屏幕像素密度选 1x 或 2x。
 * mobileH 用来覆盖手机上的显示高度（比如引导页手机上是 262px）。
 */
export function figureSrc(o: OutfitId, m: Mood, size: StageSize, mobileH?: number): FigureSrc {
  const { ar } = A.outfits[o][m];
  if (isBust(size)) {
    // 半身：图片按 1/BUST_K 放大显示，用舞台档的 430 / 860 两档，小图不糊
    const [bd, bm] = STAGE_H[size];
    const dh = Math.round(bd / BUST_K);
    const mh = Math.round((mobileH ?? bm) / BUST_K);
    const w1 = Math.round(STAGE_FILE_H[0] * ar);
    const w2 = Math.round(STAGE_FILE_H[1] * ar);
    return {
      src: url(o, m, "", 0),
      srcSet: `${url(o, m, "", 0)} ${w1}w, ${url(o, m, "-2x", 1)} ${w2}w`,
      avifSrcSet: `${avifUrl(o, m, "", 0)} ${w1}w, ${avifUrl(o, m, "-2x", 1)} ${w2}w`,
      sizes: `(max-width: 560px) ${Math.round(mh * ar)}px, ${Math.round(dh * ar)}px`,
      width: Math.round(dh * ar),
      height: dh,
    };
  }
  // 全身档（lg / md / sm）
  const fileH = STAGE_FILE_H;
  const suf = "";
  const [hd, hm0] = STAGE_H[size];
  const hm = mobileH ?? hm0;
  const w1 = Math.round(fileH[0] * ar);
  const w2 = Math.round(fileH[1] * ar);
  const i0 = 0;
  return {
    src: url(o, m, suf, i0),
    srcSet: `${url(o, m, suf, i0)} ${w1}w, ${url(o, m, suf + "-2x", i0 + 1)} ${w2}w`,
    avifSrcSet: `${avifUrl(o, m, suf, i0)} ${w1}w, ${avifUrl(o, m, suf + "-2x", i0 + 1)} ${w2}w`,
    sizes: `${BIG_H[size] ? `(min-width: 1280px) and (min-height: 820px) ${Math.round(BIG_H[size]! * ar)}px, ` : ""}(max-width: 560px) ${Math.round(hm * ar)}px, ${Math.round(hd * ar)}px`,
    width: Math.round(hd * ar),
    height: hd,
  };
}

/** 大屏（宽 ≥1280、高 ≥820）上整页场景的全身像放大到的高度，和 rinne.css 里的媒体查询一致 */
const BIG_H: Partial<Record<StageSize, number>> = { lg: 500, md: 380 };

/** 圆形头像（64 / 128）：界面里只用欢迎姿势的头像，其余状态不再单独出图（省体积） */
export function avatarSrc(o: OutfitId, mood: Mood = "welcome", exact = false) {
  // 一般场合头像只用欢迎姿势那一张；消息旁的状态头像（exact）才按状态取
  const m: Mood = exact ? mood : "welcome";
  return { src: url(o, m, "-avatar", 4), srcSet: `${url(o, m, "-avatar", 4)} 1x, ${url(o, m, "-avatar-2x", 5)} 2x` };
}

/** 衣柜缩略图（120×160 / 240×320） */
export function thumbSrc(o: OutfitId) {
  const t = A.outfits[o].thumb;
  return { src: `/img/rinne/wardrobe/${o}.${t[0]}.webp`, srcSet: `/img/rinne/wardrobe/${o}.${t[0]}.webp 1x, /img/rinne/wardrobe/${o}-2x.${t[1]}.webp 2x` };
}

/**
 * 功能页页首像：每套服装六张（头顶到大腿中部，整张入画，下沿渐隐）。
 * 只有一档 360px 高的图（显示 180px 的 2 倍），AVIF + WebP。
 */
export type PageId = "gallery" | "channels" | "usage" | "tokens" | "logs" | "settings";
export const PAGE_IDS: PageId[] = ["gallery", "channels", "usage", "tokens", "logs", "settings"];
const PAGE_ALT: Record<PageId, string> = {
  gallery: "举着一叠照片",
  channels: "正在接上网线",
  usage: "拿着平板讲解图表",
  tokens: "举着一把钥匙",
  logs: "拿着写字板核对",
  settings: "举着小扳手",
};
export function pageMeta(o: OutfitId, p: PageId): PageEntry | null {
  return A.outfits[o]?.pages?.[p] ?? A.outfits[DEFAULT_OUTFIT]?.pages?.[p] ?? null;
}
export function pageSrc(o: OutfitId, p: PageId) {
  const has = A.outfits[o]?.pages?.[p];
  const oo = has ? o : DEFAULT_OUTFIT;
  const e = pageMeta(o, p);
  if (!e) return null;
  const H = A.tiers.page ?? 360;
  return {
    webp: `/img/rinne/${oo}/page-${p}.${e.f}.webp`,
    avif: `/img/rinne/${oo}/page-${p}.${e.a}.avif`,
    width: Math.round(H * e.ar),
    height: H,
    alt: "棱音" + PAGE_ALT[p],
    meta: e,
  };
}

/**
 * 自动换装：先按当地时间和季节圈出「这个时段合适的几套」，每次访问（新开标签页/新会话）从里面随机挑一套，
 * 并尽量避开上次访问穿的那套；同一次访问内、同一时段里不变，跨时段（比如到了 22 点）才换。
 *  - 22:00–6:00：居家睡衣
 *  - 周末 6:00–9:00：运动 / 居家
 *  - 周五、周六 19:00–22:00：礼服 / 旗袍 / 风衣
 *  - 周末白天：按季节，夏（6–9 月）夏装 / 运动，冬（12–2 月）针织 / 风衣，其余风衣 / 运动 / 夏装（5、10 月）
 *  - 工作日白天：衣柜里选的那套 + 职业装 + 当季的几套
 *  - 春节前后（1 月 20 日–2 月 20 日）白天加入新中式；2 月 14 日、5 月 20 日晚上加入婚纱
 */
export function autoPool(base: OutfitId, d: Date = new Date()): { slot: string; pool: OutfitId[] } {
  const h = d.getHours();
  const wd = d.getDay();
  const mon = d.getMonth() + 1;
  const day = d.getDate();
  const weekend = wd === 0 || wd === 6;
  const date = `${d.getFullYear()}-${mon}-${day}`;
  const winter = mon === 12 || mon <= 2;
  const summer = mon >= 6 && mon <= 9;
  const spring = (mon === 1 && day >= 20) || (mon === 2 && day <= 20);
  const love = (mon === 2 && day === 14) || (mon === 5 && day === 20);
  const uniq = (l: OutfitId[]) => Array.from(new Set(l));
  if (h >= 22 || h < 6) return { slot: `${date}/night`, pool: ["home"] };
  if (weekend && h < 9) return { slot: `${date}/morning`, pool: ["sport", "home"] };
  if (h >= 19) {
    const pool: OutfitId[] = wd === 5 || wd === 6 ? ["gown", "qipao", "trench"] : [base, winter ? "winter" : summer ? "summer" : "trench", "home"];
    if (love) pool.push("bridal");
    return { slot: `${date}/evening`, pool: uniq(pool) };
  }
  const season: OutfitId[] = summer ? ["summer", "sport"] : winter ? ["winter", "trench"] : mon === 5 || mon === 10 ? ["trench", "sport", "summer"] : ["trench", "sport"];
  const pool: OutfitId[] = weekend ? season : [base, "suit", ...season];
  if (spring) pool.push("qipao");
  return { slot: `${date}/${weekend ? "weekend" : "day"}`, pool: uniq(pool) };
}

/** 只按规则取一套（不随机），给服务端首屏或测试用：返回池子里的第一套 */
export function autoOutfit(base: OutfitId, d: Date = new Date()): OutfitId {
  return autoPool(base, d).pool[0];
}

/** 存在 cookie 里的形象设置（登录页、引导页还没有设置可读时用），格式 outfit|motion|show|auto */
export const RINNE_COOKIE = "prism_rinne";
export interface RinnePrefs {
  outfit: OutfitId;
  motion: RinneMotion;
  show: boolean;
  /** 自动换装 */
  auto: boolean;
}
export const DEFAULT_PREFS: RinnePrefs = { outfit: DEFAULT_OUTFIT, motion: "system", show: true, auto: false };
export function parsePrefs(v: string | undefined | null): RinnePrefs {
  if (!v) return DEFAULT_PREFS;
  const [o, m, s, a] = decodeURIComponent(v).split("|");
  return { outfit: isOutfit(o) ? o : DEFAULT_OUTFIT, motion: isMotion(m) ? m : "system", show: s !== "0", auto: a === "1" };
}
export function prefsCookie(p: RinnePrefs) {
  return `${p.outfit}|${p.motion}|${p.show ? 1 : 0}|${p.auto ? 1 : 0}`;
}
