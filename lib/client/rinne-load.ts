/**
 * 立绘的预加载：
 * - preloadFigure：下载并 decode 完再返回（换装、切状态前用，保证不出现半张图）
 * - prefetchFigure：只在后台下载进缓存（悬停衣柜缩略图、空闲时、状态快要切换时用）
 * - idlePrefetch：页面 load 之后再等一会儿，在浏览器空闲时预取接下来可能用到的状态
 * 同一张图只下载一次。省流量模式下不做空闲预取。
 * 页面里的立绘是 <picture>（AVIF 优先，WebP 兜底）；这里先探测一次浏览器支不支持 AVIF，
 * 预取时挑和 <picture> 同一种格式、同一组 srcset/sizes，之后页面直接命中缓存。
 */
import { figureSrc, type Mood, type OutfitId, type StageSize } from "@/lib/rinne";

const decoded = new Map<string, Promise<void>>();
const fetched = new Set<string>();

// 1×1 的 AVIF（用 Pillow 生成），能解码就说明支持
const AVIF_PROBE =
  "data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAIQAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAQAAAAEAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAKW1kYXQSAAoIGAAGiAhoNCAyExlHh4Yhh5555oAAAJBAyRxgjag=";
let avifP: Promise<boolean> | null = null;
function avifOk(): Promise<boolean> {
  if (!avifP) {
    avifP = new Promise((res) => {
      const i = new Image();
      i.onload = () => res(i.width > 0);
      i.onerror = () => res(false);
      i.src = AVIF_PROBE;
    });
  }
  return avifP;
}

function keyOf(o: OutfitId, m: Mood, size: StageSize, mobileH?: number) {
  const s = figureSrc(o, m, size, mobileH);
  return `${s.srcSet}|${s.sizes}`;
}

function makeImg(o: OutfitId, m: Mood, size: StageSize, mobileH: number | undefined, avif: boolean) {
  const s = figureSrc(o, m, size, mobileH);
  const img = new Image();
  img.decoding = "async";
  img.sizes = s.sizes;
  img.srcset = avif ? s.avifSrcSet : s.srcSet;
  img.src = s.src;
  return img;
}

function decodeImg(img: HTMLImageElement): Promise<void> {
  if (img.decode) return img.decode();
  return new Promise<void>((res, rej) => ((img.onload = () => res()), (img.onerror = rej)));
}

export function preloadFigure(o: OutfitId, m: Mood, size: StageSize, mobileH?: number): Promise<void> {
  const key = keyOf(o, m, size, mobileH);
  const hit = decoded.get(key);
  if (hit) return hit;
  fetched.add(key);
  const p = avifOk()
    .then((avif) => decodeImg(makeImg(o, m, size, mobileH, avif)))
    .catch(() => {
      // 解码失败（比如离线）：不缓存失败结果，下次再试
      decoded.delete(key);
    })
    .then(() => undefined);
  decoded.set(key, p);
  return p;
}

export function prefetchFigure(o: OutfitId, m: Mood, size: StageSize = "md", mobileH?: number) {
  if (typeof window === "undefined") return;
  const key = keyOf(o, m, size, mobileH);
  if (fetched.has(key)) return;
  fetched.add(key);
  void avifOk().then((avif) => makeImg(o, m, size, mobileH, avif));
}

function saveData() {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !!c?.saveData;
}

type IdleWin = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };

/** load 之后至少等 delay 毫秒，再在空闲时预取。返回取消函数。 */
export function idlePrefetch(jobs: [OutfitId, Mood, StageSize][], delay = 2500, still: () => boolean = () => true): () => void {
  if (typeof window === "undefined" || saveData()) return () => {};
  const w = window as IdleWin;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idle: number | undefined;
  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    const go = () => !cancelled && still() && jobs.forEach(([o, m, s]) => prefetchFigure(o, m, s));
    if (w.requestIdleCallback) idle = w.requestIdleCallback(go, { timeout: 4000 });
    else go();
  };
  const start = () => {
    timer = setTimeout(run, delay);
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    if (idle !== undefined) w.cancelIdleCallback?.(idle);
    window.removeEventListener("load", start);
  };
}

/** 衣柜缩略图悬停 / 聚焦时：预取这套服装的几张图，点下去时直接淡入 */
export function prefetchOutfit(o: OutfitId, moods: Mood[] = ["welcome"], size: StageSize = "md") {
  for (const m of moods) prefetchFigure(o, m, size);
}
