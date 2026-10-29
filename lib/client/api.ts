"use client";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    cache: "no-store",
  });
  if (res.status === 401 && !url.startsWith("/api/auth")) {
    if (typeof window !== "undefined") window.location.href = "/login";
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* 空响应 */
  }
  if (!res.ok) {
    const e = (data as { error?: unknown })?.error;
    const msg = typeof e === "string" ? e : (e as { message?: string })?.message || `请求失败（${res.status}）`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

/** 读取服务端 SSE：onEvent(event, data) */
export async function readEvents(res: Response, onEvent: (event: string, data: unknown) => void) {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let ev = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) ev = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (!data.length) continue;
      try {
        onEvent(ev, JSON.parse(data.join("\n")));
      } catch {
        onEvent(ev, data.join("\n"));
      }
    }
  }
}

/** 压缩图片（长边不超过 2048，超过 3MB 转 JPEG）后上传，返回图片地址 */
export async function uploadImage(file: File): Promise<string> {
  let blob: Blob = file;
  try {
    blob = await shrink(file);
  } catch {
    /* 压缩失败就传原图 */
  }
  const fd = new FormData();
  fd.append("file", blob, file.name || "image");
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "上传失败");
  return j.url as string;
}

async function shrink(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file;
  const bmp = await createImageBitmap(file);
  const max = 2048;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 3 * 1024 * 1024) return file;
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const type = file.type === "image/png" && file.size < 3 * 1024 * 1024 ? "image/png" : "image/jpeg";
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("压缩失败"))), type, 0.9));
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function fmtMs(ms?: number) {
  if (ms == null) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function fmtTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
