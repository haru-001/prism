"use client";

import { useSyncExternalStore } from "react";
import { api } from "./api";
import type { AsRow, LibManifest, PromptDoc, R18Row, SavedPrompt, SxBody, SxIndex, UserPrompt } from "../prompts/types";

/**
 * 提示词库的浏览器端数据层：
 * - 数据文件是 .json.gz，浏览器自己解压（静态直出，不依赖服务器的压缩配置）；地址带版本号，HTTP 缓存一年
 * - 同一个文件同时只请求一次，结果留在内存里：切页面再回来不用重新下载、重新解析
 * - 我的提示词 / 收藏：先显示 localStorage 里的上一份，同时向服务端确认最新
 */

// ===== 数据文件 =====
async function loadGz<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "same-origin" });
  if (r.status === 401 && typeof window !== "undefined") window.location.href = "/login";
  if (!r.ok) throw new Error(`数据加载失败（HTTP ${r.status}）`);
  const buf = new Uint8Array(await r.arrayBuffer());
  // 服务器（或 CDN）已经按 Content-Encoding 解压过时，拿到的就是 JSON 文本
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(buf)) as T;
  if (typeof DecompressionStream === "undefined") throw new Error("浏览器版本太旧，无法解压提示词数据，请升级浏览器");
  const txt = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(txt) as T;
}

const mem = new Map<string, Promise<unknown>>();
function cached<T>(url: string): Promise<T> {
  let p = mem.get(url) as Promise<T> | undefined;
  if (!p) {
    p = loadGz<T>(url);
    mem.set(url, p);
    p.catch(() => mem.delete(url));
  }
  return p;
}

export const indexUrl = (m: LibManifest) => m.sx.url + "index.json.gz";
export const sxIndex = (m: LibManifest) => cached<SxIndex>(indexUrl(m));
export const sxChunk = (m: LibManifest, n: number) => cached<SxBody[]>(`${m.sx.url}p${n}.json.gz`);
export const sxPinyin = (m: LibManifest) => cached<Record<string, string>>(m.sx.url + "py.json.gz");
export const r18Chunk = (m: LibManifest, n: number) => cached<R18Row[]>(`${m.r18.url}p${n}.json.gz?v=${m.r18.ver}`);
export const asExamples = (m: LibManifest) => cached<AsRow[]>(`${m.as.url}ex.json.gz?v=${m.as.ver}`);
/** 数据更新后清掉内存里的旧数据 */
export function dropLibCache() {
  mem.clear();
}

// ===== 偏好（只存在这台设备上）=====
export interface LibPrefs {
  /** 已确认满 18 岁：显示「大凶」分类和 R18 库 */
  adult: boolean;
  /** 自己隐藏的大类（按名字） */
  hidden: string[];
  /** 封面：proxy = 经本站转发的缩略图（默认，国内直连稳、图小）；direct = 直连水仙库图床 */
  cover: "proxy" | "direct";
  /** R18 详情默认显示中文版 */
  r18zh: boolean;
  /** R18 库：as = 亚洲写真；st = 英文精选 */
  rs: "as" | "st";
}
const PREFS_KEY = "prism-pl-prefs";
const defPrefs: LibPrefs = { adult: false, hidden: [], cover: "proxy", r18zh: true, rs: "as" };
let prefs: LibPrefs | null = null;
const prefSubs = new Set<() => void>();
function readPrefs(): LibPrefs {
  if (prefs) return prefs;
  try {
    prefs = { ...defPrefs, ...(JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as Partial<LibPrefs>) };
  } catch {
    prefs = { ...defPrefs };
  }
  return prefs;
}
export function setPrefs(p: Partial<LibPrefs>) {
  prefs = { ...readPrefs(), ...p };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* 存储满了也不影响本次使用 */
  }
  prefSubs.forEach((f) => f());
}
export function useLibPrefs(): LibPrefs {
  return useSyncExternalStore(
    (f) => {
      prefSubs.add(f);
      return () => prefSubs.delete(f);
    },
    readPrefs,
    () => defPrefs,
  );
}

/** 封面地址：path 是图床上的相对路径（如 originals/123.jpg） */
export function coverUrl(m: LibManifest, p: string, w: 360 | 720 | 0, mode: LibPrefs["cover"] = "proxy") {
  if (!p) return "";
  if (mode === "direct") return m.imgRemote + p;
  return m.img + p.split("/").map(encodeURIComponent).join("/") + (w ? `?w=${w}` : "");
}

// ===== 我的提示词 + 收藏（服务端保存）=====
const DOC_KEY = "prism-pl-doc";
let doc: PromptDoc | null = null;
let docLoaded = false;
let docLoading: Promise<void> | null = null;
const docSubs = new Set<() => void>();
const emptyDoc: PromptDoc = { items: [], favs: [] };
function emitDoc() {
  docSubs.forEach((f) => f());
}
function readDoc(): PromptDoc {
  if (doc) return doc;
  try {
    const s = localStorage.getItem(DOC_KEY);
    if (s) doc = JSON.parse(s) as PromptDoc;
  } catch {
    /* 忽略 */
  }
  return doc || emptyDoc;
}
function setDoc(d: PromptDoc) {
  doc = d;
  try {
    localStorage.setItem(DOC_KEY, JSON.stringify(d));
  } catch {
    /* 忽略 */
  }
  emitDoc();
}
/** 向服务端读一次最新的（同时只发一个请求） */
export function loadDoc(force = false): Promise<void> {
  if (docLoaded && !force) return Promise.resolve();
  if (docLoading) return docLoading;
  docLoading = api<PromptDoc>("/api/prompts")
    .then((d) => {
      docLoaded = true;
      setDoc(d);
    })
    .finally(() => {
      docLoading = null;
    });
  return docLoading;
}
export function usePromptDoc(): { doc: PromptDoc; loaded: boolean } {
  const d = useSyncExternalStore(
    (f) => {
      docSubs.add(f);
      return () => docSubs.delete(f);
    },
    readDoc,
    () => emptyDoc,
  );
  return { doc: d, loaded: docLoaded };
}

// 保存排队发：服务端是「读出 → 合并 → 写回」，同时两次保存时后一次会盖掉前一次
let saveQ: Promise<unknown> = Promise.resolve();
function save(patch: Partial<PromptDoc>) {
  const run = saveQ.catch(() => {}).then(() => api<PromptDoc>("/api/prompts", { method: "PUT", body: patch }));
  saveQ = run;
  return run.then((d) => {
    if (saveQ === run) setDoc(d);
    return d;
  });
}
export function saveItems(items: UserPrompt[]) {
  setDoc({ ...readDoc(), items });
  return save({ items });
}
export function saveFavs(favs: SavedPrompt[]) {
  setDoc({ ...readDoc(), favs });
  return save({ favs });
}
export function isFav(key: string) {
  return readDoc().favs.some((x) => x.key === key);
}
/** 收藏 / 取消收藏；返回切换后的状态 */
export function toggleFav(item: Omit<SavedPrompt, "time">): Promise<boolean> {
  const l = readDoc().favs;
  const on = l.some((x) => x.key === item.key);
  const next = on ? l.filter((x) => x.key !== item.key) : [{ ...item, time: Date.now() }, ...l].slice(0, 2000);
  return saveFavs(next).then(() => !on);
}
/** 用自己的提示词画过图：第一次画出的图作封面 */
export function setCover(id: string, url: string) {
  const items = readDoc().items;
  const it = items.find((x) => x.id === id);
  if (!it || it.cover) return;
  void saveItems(items.map((x) => (x.id === id ? { ...x, cover: url } : x))).catch(() => {});
}

// ===== 最近使用（只存在这台设备上）=====
const RECENT_KEY = "prism-pl-recent";
let recentCache: SavedPrompt[] | null = null;
const recentSubs = new Set<() => void>();
function readRecent(): SavedPrompt[] {
  if (recentCache) return recentCache;
  try {
    recentCache = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as SavedPrompt[];
  } catch {
    recentCache = [];
  }
  return recentCache;
}
const noRecent: SavedPrompt[] = [];
export function setRecent(l: SavedPrompt[]) {
  recentCache = l.slice(0, 100);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentCache));
  } catch {
    /* 忽略 */
  }
  recentSubs.forEach((f) => f());
}
export function addRecent(item: Omit<SavedPrompt, "time">) {
  setRecent([{ ...item, time: Date.now() }, ...readRecent().filter((x) => x.key !== item.key)]);
}
export function useRecent(): SavedPrompt[] {
  return useSyncExternalStore(
    (f) => {
      recentSubs.add(f);
      return () => recentSubs.delete(f);
    },
    readRecent,
    () => noRecent,
  );
}

// 送去画图 / 对话：放在单独的小文件里（对话页也要用，不想把整个提示词库的代码带进去）
export { setChatDraft, setDrawDraft, takeChatDraft, takeDrawDraft, type ChatDraft, type DrawDraft } from "./handoff";

/** 下载一份文本文件（导出备份用） */
export function downloadText(name: string, text: string, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
