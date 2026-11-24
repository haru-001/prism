"use client";

import { useSyncExternalStore } from "react";
import { notifyDbDown, uid } from "./api";
import type { GalleryItem, MsgError } from "../types";
import { setCover } from "./promptlib";

/**
 * 画图任务队列：放在模块里，切到别的页面再回来任务照常进行、结果还在（站内跳转不会中断请求）。
 * 连接断了（手机切网络、反向代理超时）但服务端其实已经把图存进图库时，自动去图库里把结果找回来（haru 的做法）。
 */

export interface DrawParams {
  model: string;
  channelId?: string;
  prompt: string;
  size: string;
  n: number;
  quality: string;
  refs: string[];
  /** 来自哪条提示词（my:xxx 画完把第一张设成它的封面） */
  key?: string;
}

export interface DrawJob extends DrawParams {
  id: string;
  start: number;
  end?: number;
  status: "running" | "recovering" | "done" | "error";
  images?: string[];
  error?: MsgError;
  channel?: string;
  latencyMs?: number;
  revisedPrompt?: string;
  notices?: string[];
  /** 结果是从图库里找回来的 */
  recovered?: boolean;
}

let jobs: DrawJob[] = [];
const ctrls = new Map<string, AbortController>();
const subs = new Set<() => void>();
const PENDING = "prism-draw-pending";

function emit() {
  jobs = [...jobs];
  subs.forEach((f) => f());
  try {
    const p = jobs.filter((j) => j.status === "running" || j.status === "recovering").map(({ id, model, prompt, start, size, n, quality, refs, key }) => ({ id, model, prompt, start, size, n, quality, refs, key }));
    if (p.length) localStorage.setItem(PENDING, JSON.stringify(p));
    else localStorage.removeItem(PENDING);
  } catch {
    /* 忽略 */
  }
}
function patch(id: string, p: Partial<DrawJob>) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...p } : j));
  emit();
}

export function useDrawJobs(): DrawJob[] {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => jobs,
    () => EMPTY,
  );
}
const EMPTY: DrawJob[] = [];

export function dismissJob(id: string) {
  ctrls.get(id)?.abort();
  ctrls.delete(id);
  jobs = jobs.filter((j) => j.id !== id);
  emit();
}
export function cancelJob(id: string) {
  const c = ctrls.get(id);
  if (!c) return;
  c.abort();
  patch(id, { status: "error", end: Date.now(), error: { title: "已停止", message: "上游可能仍在生成，但这次的结果不会保存。" } });
}
export function clearFinished() {
  jobs = jobs.filter((j) => j.status === "running" || j.status === "recovering");
  emit();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 去图库里找这次的结果：同一段提示词、同一个模型、开始之后才存进去的图 */
async function findInGallery(job: Pick<DrawJob, "prompt" | "model" | "start">): Promise<string[]> {
  const r = await fetch("/api/gallery?kind=image&limit=40", { cache: "no-store" });
  if (!r.ok) return [];
  const j = (await r.json()) as { items: GalleryItem[] };
  const p = job.prompt.trim();
  return j.items
    .filter((x) => x.prompt === p && x.model === job.model && x.createdAt >= job.start - 3000)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((x) => x.url);
}

async function recover(id: string, tries: number, gap: number) {
  patch(id, { status: "recovering" });
  for (let i = 0; i < tries; i++) {
    await sleep(gap);
    const job = jobs.find((j) => j.id === id);
    if (!job || job.status !== "recovering") return;
    try {
      const urls = await findInGallery(job);
      if (urls.length) {
        patch(id, { status: "done", images: urls, recovered: true, end: Date.now() });
        if (job.key?.startsWith("my:")) setCover(job.key.slice(3), urls[0]);
        return;
      }
    } catch {
      /* 接着找 */
    }
  }
  const job = jobs.find((j) => j.id === id);
  if (job?.status === "recovering")
    patch(id, { status: "error", end: Date.now(), error: { title: "连接中断", message: "和服务器的连接断了，图库里也没找到这次的结果。可以点重试。" } });
}

export function startJob(p: DrawParams): string {
  const id = uid();
  const job: DrawJob = { ...p, prompt: p.prompt.trim(), id, start: Date.now(), status: "running" };
  jobs = [job, ...jobs].slice(0, 40);
  emit();
  const ac = new AbortController();
  ctrls.set(id, ac);
  void (async () => {
    let res: Response;
    try {
      res = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: p.model, channelId: p.channelId, prompt: job.prompt, size: p.size, n: p.n, quality: p.quality || undefined, refs: p.refs }),
        signal: ac.signal,
      });
    } catch (e) {
      ctrls.delete(id);
      if ((e as Error).name === "AbortError") return;
      // 请求发出去了但连接断了：服务端可能已经画完存好，去图库找（约 3 分钟）
      return recover(id, 36, 5000);
    }
    ctrls.delete(id);
    let j: { images?: string[]; error?: MsgError | string; channel?: string; latencyMs?: number; revisedPrompt?: string; notices?: { text: string }[] } | null = null;
    try {
      j = await res.json();
    } catch {
      j = null;
    }
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!res.ok || !j) {
      if (j) notifyDbDown(res.status, j);
      // 网关超时 / 响应不完整：同样去图库找一找
      if (!j || res.status === 502 || res.status === 504 || res.status === 524) return recover(id, 24, 5000);
      const e = j.error;
      return patch(id, { status: "error", end: Date.now(), error: typeof e === "string" ? { title: "生成失败", message: e } : e || { title: "生成失败", message: `HTTP ${res.status}` } });
    }
    if (j.error || !j.images?.length) {
      const e = j.error;
      return patch(id, {
        status: "error",
        end: Date.now(),
        error: typeof e === "string" ? { title: "生成失败", message: e } : e || { title: "生成失败", message: "上游没有返回图片" },
        notices: j.notices?.map((n) => n.text),
      });
    }
    patch(id, {
      status: "done",
      end: Date.now(),
      images: j.images,
      channel: j.channel,
      latencyMs: j.latencyMs,
      revisedPrompt: j.revisedPrompt,
      notices: j.notices?.map((n) => n.text),
    });
    if (p.key?.startsWith("my:")) setCover(p.key.slice(3), j.images[0]);
  })();
  return id;
}

export function retryJob(id: string) {
  const j = jobs.find((x) => x.id === id);
  if (!j) return;
  dismissJob(id);
  startJob({ model: j.model, channelId: j.channelId, prompt: j.prompt, size: j.size, n: j.n, quality: j.quality, refs: j.refs, key: j.key });
}

/**
 * 页面刷新前还在生成的任务：请求已经随页面关掉了，服务端多半也停了；
 * 但如果在断开前已经画完，图会在图库里，找一下（约 30 秒）。
 */
let restored = false;
export function restorePending() {
  if (restored) return;
  restored = true;
  try {
    const l = JSON.parse(localStorage.getItem(PENDING) || "[]") as DrawParams[] & { id: string; start: number }[];
    localStorage.removeItem(PENDING);
    const fresh = (l as (DrawParams & { id: string; start: number })[]).filter((x) => x?.id && Date.now() - x.start < 10 * 60_000);
    if (!fresh.length) return;
    for (const x of fresh) jobs.push({ ...x, status: "recovering" });
    emit();
    for (const x of fresh) void recover(x.id, 6, 5000);
  } catch {
    /* 忽略 */
  }
}
