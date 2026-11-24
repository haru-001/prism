/**
 * 把「水仙的AI提示词」上游数据（shuixian-unified/data）编译成 Prism 的本地提示词库：
 *   index.json.gz  首屏索引（标题、分类、封面、热度、标签、建议比例），约 160KB
 *   p{n}.json.gz   正文分块，每块 250 条：[[prompt, images[]], ...]，打开详情时才下载
 *   py.json.gz     汉字 → 拼音首字母表（上游 pinyin.json），搜索拼音首字母时才下载
 * 格式沿用 haru 的做法（行序 = 热度降序；第 i 条的正文在 p{floor(i/250)} 的第 i%250 项）。
 *
 * 这个文件不依赖 Next / 数据库：服务端同步接口和 scripts/prompt-lib/build.mjs 共用。
 * 只用 node:zlib / node:crypto，可以被 node --experimental-strip-types 直接加载。
 */
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

export const SX_REPO = "BaYue-SYJ/shuixian-prompts";
export const SX_DIR = "shuixian-unified/data";
export const SX_BRANCH = "main";
export const SX_CHUNK = 250;
export const IMG_BASE = "https://r2.qqsrc.com/images/";
/** 分类名里带这些字的整类默认隐藏，确认已满 18 岁后才显示 */
export const NSFW_RE = /大凶|诱惑|NSFW|R18/i;

export interface SxRaw {
  id?: number;
  title?: string;
  category?: string;
  image?: string;
  images?: string[];
  likes?: number;
  themes?: string[];
  styles?: string[];
  prompt?: string;
  w?: number;
  h?: number;
}

export interface SxMeta {
  hot?: string[];
  majors?: { name: string; main?: string; subs?: { name: string }[] }[];
}

export interface BuildInput {
  parts: SxRaw[][];
  categories: Record<string, { major?: string }>;
  meta: SxMeta;
  pinyin?: { chars?: Record<string, string> } | null;
  /** id → [w, h]：上游站点 list.part*.json 里有图片尺寸（仓库里没有），拿不到就不给建议比例 */
  sizes?: Map<number, [number, number]>;
}

export interface BuildOutput {
  files: Record<string, Buffer>;
  count: number;
  chunks: number;
  dataHash: string;
}

const RATIOS: [string, number][] = [
  ["1:1", 1],
  ["4:5", 4 / 5],
  ["3:4", 3 / 4],
  ["2:3", 2 / 3],
  ["9:16", 9 / 16],
  ["5:4", 5 / 4],
  ["4:3", 4 / 3],
  ["3:2", 3 / 2],
  ["16:9", 16 / 9],
  ["21:9", 21 / 9],
];

/** 宽高换算成最接近的常用比例 */
export function nearestRatio(w?: number, h?: number): string {
  if (!w || !h) return "";
  const r = Math.log(w / h);
  let best = "";
  let d = Infinity;
  for (const [name, v] of RATIOS) {
    const x = Math.abs(Math.log(v) - r);
    if (x < d) {
      d = x;
      best = name;
    }
  }
  return best;
}

const gz = (o: unknown) => gzipSync(Buffer.from(JSON.stringify(o)), { level: 9 });
const strip = (p: unknown) => String(p || "").replace(/^images\//, "");

/** 上游内容的指纹：内容没变时同步只更新版本号 */
export function hashParts(raw: (string | Buffer)[]) {
  const h = createHash("md5");
  for (const r of raw) h.update(r);
  return h.digest("hex");
}

export function buildSx(input: BuildInput, dataHash: string): BuildOutput {
  const seen = new Set<number>();
  type Row = { id: number; title: string; cat: string; img: string; likes: number; imgs: string[]; tags: string[]; prompt: string };
  const list: Row[] = [];
  for (const part of input.parts) {
    for (const x of part || []) {
      const id = Number(x?.id) || 0;
      const prompt = String(x?.prompt || "").trim();
      if (!id || !prompt || seen.has(id)) continue;
      seen.add(id);
      const tags = Array.from(new Set([...(x.themes || []), ...(x.styles || [])].map(String))).slice(0, 6);
      list.push({
        id,
        title: String(x.title || ""),
        cat: String(x.category || "其他"),
        img: strip(x.image),
        likes: Number(x.likes) || 0,
        imgs: (x.images || []).slice(0, 9).map(strip),
        tags,
        prompt,
      });
    }
  }
  if (list.length < 100) throw new Error(`上游数据异常（只有 ${list.length} 条），已中止，本地数据未改动`);
  list.sort((a, b) => b.likes - a.likes || b.id - a.id);

  const metaMajors = input.meta.majors || [];
  const majors: string[] = metaMajors.map((m) => m.name);
  const colors: Record<string, string | null> = {};
  for (const m of metaMajors) colors[m.name] = m.main || null;
  const subs: string[] = [];
  const subIdx = new Map<string, number>();
  const subMajor: number[] = [];
  const rows: (string | number)[][] = [];
  const files: Record<string, Buffer> = {};
  let chunk: [string, string[]][] = [];
  let n = 0;
  for (const x of list) {
    const major = input.categories[x.cat]?.major || x.cat;
    if (!majors.includes(major)) majors.push(major);
    if (!subIdx.has(x.cat)) {
      subIdx.set(x.cat, subs.length);
      subs.push(x.cat);
    }
    const si = subIdx.get(x.cat)!;
    subMajor[si] = majors.indexOf(major);
    const wh = input.sizes?.get(x.id);
    const imgs = x.imgs.length ? x.imgs : x.img ? [x.img] : [];
    rows.push([x.id, x.title, si, x.img, x.likes, Math.max(1, imgs.length), x.tags.join("|"), nearestRatio(wh?.[0], wh?.[1])]);
    chunk.push([x.prompt, imgs]);
    if (chunk.length === SX_CHUNK) {
      files[`p${n}`] = gz(chunk);
      chunk = [];
      n++;
    }
  }
  if (chunk.length) {
    files[`p${n}`] = gz(chunk);
    n++;
  }
  const nsfwMajors: number[] = [];
  majors.forEach((m, i) => {
    if (NSFW_RE.test(m)) nsfwMajors.push(i);
  });
  // 小类名里带「诱惑」等字、但挂在别的大类下的，也单独标出来
  const nsfwSubs: number[] = [];
  subs.forEach((s, i) => {
    if (NSFW_RE.test(s)) nsfwSubs.push(i);
  });
  files.index = gz({
    cols: ["id", "title", "sub", "img", "likes", "nImg", "tags", "ratio"],
    majors: majors.map((m) => [m, colors[m] ?? null]),
    subs: subs.map((s, i) => [s, subMajor[i]]),
    nsfwMajors,
    nsfwSubs,
    hot: (input.meta.hot || []).slice(0, 16),
    chunk: SX_CHUNK,
    rows,
  });
  if (input.pinyin?.chars) files.py = gz(input.pinyin.chars);
  return { files, count: rows.length, chunks: n, dataHash };
}

/** 上游站点 list.part*.json → id 到 [w, h] */
export function sizesFromLists(lists: unknown[]): Map<number, [number, number]> {
  const m = new Map<number, [number, number]>();
  for (const l of lists) {
    if (!Array.isArray(l)) continue;
    for (const x of l as { id?: number; w?: number; h?: number }[]) {
      if (x?.id && x.w && x.h) m.set(Number(x.id), [Number(x.w), Number(x.h)]);
    }
  }
  return m;
}
