import "server-only";
import { put } from "@vercel/blob";
import { env } from "./env";
import { kv, P, storageKind } from "./kv";
import { randomId } from "./crypto";
import { q, T } from "./mysql";
import type { RowDataPacket } from "mysql2/promise";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { BLOB_PUBLIC_HOST, FILES, localImageUrl, verifyImgSig } from "./imgurl";

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * 保存图片，返回可以直接放进 <img src> 的本站地址（带签名，见 imgurl.ts）：
 * - 配了 Vercel Blob：存 Blob（公开或私有都一样，浏览器只看到 /api/files/b/... 或 /api/files/bp/...）
 * - 用 MySQL（Aiven）：压缩后存进 prism_files 表，总量超过 DB_IMAGES_MAX_MB 时删掉最早的图
 * - 本地开发：存进 .data/kv.json
 * 都由 /api/files/[...path] 在服务端读取后输出，浏览器不会直连任何外部域名。
 */
export async function saveFile(buf: Buffer, mime: string, folder = "images"): Promise<string> {
  return localImageUrl(await saveFileRaw(buf, mime, folder));
}

async function saveFileRaw(buf: Buffer, mime: string, folder: string): Promise<string> {
  const id = randomId(16);
  if (env.blobToken) {
    const ext = EXT[mime] || "bin";
    const pathname = `prism/${folder}/${id}.${ext}`;
    if (env.blobAccess === "public") {
      try {
        const r = await put(pathname, buf, { access: "public", contentType: mime, token: env.blobToken });
        return r.url;
      } catch (e) {
        const msg = String((e as Error)?.message || e);
        if (!/private/i.test(msg)) throw e;
        // 存储是私有的，改用 private 再试一次
      }
    }
    await put(pathname, buf, { access: "private", contentType: mime, token: env.blobToken });
    return `/api/files/b/${encodeURIComponent(pathname)}`;
  }
  if (storageKind() === "mysql") {
    const f = await shrinkForDb(buf, mime);
    await q(`INSERT INTO ${T.files} (id, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?)`, [id, f.mime, f.buf.length, f.buf, Date.now()]);
    await evictOldFiles().catch((e) => console.error("[prism] 清理旧图片失败", e));
    return `/api/files/${id}.${EXT[f.mime] || "bin"}`;
  }
  await kv().set(P + "file:" + id, { mime, data: buf.toString("base64") });
  return `/api/files/${id}.${EXT[mime] || "bin"}`;
}

const SHRINK_FROM = 200 * 1024;

/**
 * 存进数据库前压缩：超过 200KB 的 PNG / JPG / WebP 转成 WebP（质量 85，长边不超过 2048），
 * 还超过 DB_IMAGE_MAX_KB 就逐步缩小尺寸。GIF（可能是动图）原样保存。压缩失败时原样保存。
 */
export async function shrinkForDb(buf: Buffer, mime: string): Promise<{ buf: Buffer; mime: string }> {
  if (buf.length <= SHRINK_FROM || mime === "image/gif" || !EXT[mime]) return { buf, mime };
  try {
    const sharp = (await import("sharp")).default;
    const max = env.imageMaxKB * 1024;
    let best: Buffer | null = null;
    for (const [side, quality] of [
      [2048, 85],
      [1600, 80],
      [1280, 78],
      [1024, 75],
      [768, 70],
    ] as const) {
      const out = await sharp(buf, { failOn: "none" })
        .rotate()
        .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
      best = out;
      if (out.length <= max) break;
    }
    if (best && best.length < buf.length) return { buf: best, mime: "image/webp" };
  } catch (e) {
    console.error("[prism] 图片压缩失败，按原图保存", e);
  }
  return { buf, mime };
}

/** 图片总量超过 DB_IMAGES_MAX_MB 时，从最早的开始删，删到上限的 90% */
export async function evictOldFiles() {
  const cap = env.imagesMaxMB * 1024 * 1024;
  const [{ total }] = await q<RowDataPacket[]>(`SELECT COALESCE(SUM(size), 0) AS total FROM ${T.files}`);
  let over = Number(total) - cap;
  if (over <= 0) return 0;
  over += cap * 0.1;
  const rows = await q<RowDataPacket[]>(`SELECT id, size FROM ${T.files} ORDER BY created_at ASC LIMIT 500`);
  const ids: string[] = [];
  for (const r of rows) {
    if (over <= 0) break;
    ids.push(r.id);
    over -= Number(r.size);
  }
  if (ids.length) {
    for (const id of ids) forget(id);
    await q(`DELETE FROM ${T.files} WHERE id IN (?)`, [ids]);
  }
  return ids.length;
}

/** 站内图片地址 /api/files/{id}.{ext} 里的 id；Blob、外链代理和外链返回 null */
export function localFileId(url: string): string | null {
  if (!url.startsWith(FILES) || /^\/api\/files\/(b|bp|ext)([/?]|$)/.test(url)) return null;
  return url.slice(FILES.length).split(/[.?]/)[0] || null;
}

/** 在 MySQL 里还存在的图片 id（被清理掉的不在其中） */
export async function existingFileIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length || storageKind() !== "mysql") return new Set(ids);
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await q<RowDataPacket[]>(`SELECT id FROM ${T.files} WHERE id IN (?)`, [ids.slice(i, i + 500)]);
    for (const r of rows) out.add(r.id);
  }
  return out;
}

/** 所有存在 MySQL 里的图片 id（只读 id 列，不读图片数据）；不是 MySQL 存储时返回 null */
export async function allDbFileIds(): Promise<Set<string> | null> {
  if (storageKind() !== "mysql") return null;
  const rows = await q<RowDataPacket[]>(`SELECT id FROM ${T.files}`);
  return new Set(rows.map((r) => r.id as string));
}

/**
 * 图片内容写入后永远不变：每个实例在内存里留最近读过的图（最多约 24MB），
 * 同一张图再次打开时不用再查库（线上还有 CDN 缓存挡在前面）。图被自动清理时同步移除。
 */
const MEM_BUDGET = 24 * 1024 * 1024;
const g = globalThis as unknown as { __prismFileCache?: Map<string, { mime: string; data: Buffer }> };
const mem = (g.__prismFileCache ??= new Map());
let memBytes = 0;
function forget(id: string) {
  const v = mem.get(id);
  if (v) {
    memBytes -= v.data.length;
    mem.delete(id);
  }
}
function keep(id: string, v: { mime: string; data: Buffer }) {
  if (v.data.length > MEM_BUDGET / 8) return;
  forget(id);
  mem.set(id, v);
  memBytes += v.data.length;
  while (memBytes > MEM_BUDGET && mem.size) forget(mem.keys().next().value as string);
}

/** 清理图片后把这些图从本实例的内存缓存里去掉 */
export function forgetFiles(ids: string[]) {
  for (const id of ids) forget(id);
}

export async function readKvFile(id: string): Promise<{ mime: string; data: Buffer } | null> {
  const hit = mem.get(id);
  if (hit) {
    mem.delete(id);
    mem.set(id, hit);
    return hit;
  }
  const v = await readKvFileFromDb(id);
  if (v) keep(id, v);
  return v;
}

async function readKvFileFromDb(id: string): Promise<{ mime: string; data: Buffer } | null> {
  if (storageKind() === "mysql") {
    const rows = await q<RowDataPacket[]>(`SELECT mime, data FROM ${T.files} WHERE id = ?`, [id]);
    if (rows[0]) return { mime: rows[0].mime, data: Buffer.from(rows[0].data) };
  }
  const v = await kv().get<{ mime: string; data: string }>(P + "file:" + id);
  if (!v) return null;
  return { mime: v.mime, data: Buffer.from(v.data, "base64") };
}

/** 把任意图片地址（data: / 站内 /api/files / http）转成 base64，供上游使用 */
export async function resolveImage(url: string): Promise<{ data: string; mime: string }> {
  if (url.startsWith("data:")) {
    const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url);
    if (!m) throw new Error("无法解析的图片");
    const mime = m[1] || "image/png";
    const data = m[2] ? m[3] : Buffer.from(decodeURIComponent(m[3])).toString("base64");
    return { data, mime };
  }
  if (url.startsWith(FILES)) {
    const f = await readLocalImage(url);
    if (!f) throw new Error("图片不存在");
    return { data: f.data.toString("base64"), mime: f.mime };
  }
  // 本站发出去的完整链接（API 客户端把生图结果再传回来识图时）：签名对得上就直接读，不绕一圈 HTTP
  try {
    const x = new URL(url);
    if (x.pathname.startsWith(FILES) && verifyImgSig(x.pathname, x.searchParams)) {
      const f = await readLocalImage(x.pathname + x.search);
      if (f) return { data: f.data.toString("base64"), mime: f.mime };
    }
  } catch {}
  const f = await fetchRemoteImage(url);
  return { data: f.data.toString("base64"), mime: f.mime };
}

/** 读站内地址 /api/files/...（可带查询参数）对应的图片内容；读不到返回 null */
export async function readLocalImage(url: string): Promise<{ mime: string; data: Buffer } | null> {
  const q = url.indexOf("?");
  const path = q < 0 ? url : url.slice(0, q);
  const sp = new URLSearchParams(q < 0 ? "" : url.slice(q + 1));
  const rest = path.slice(FILES.length);
  if (rest === "ext") {
    const u = sp.get("u");
    return u ? fetchRemoteImage(u) : null;
  }
  const segs = rest.split("/").map((x) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return x;
    }
  });
  if (segs[0] === "b" || segs[0] === "bp") {
    const r = await readBlob(segs);
    if (!r) return null;
    return { mime: r.mime, data: Buffer.from(await new Response(r.body).arrayBuffer()) };
  }
  return readKvFile(segs[0].split(".")[0]);
}

/**
 * 读 Blob 里的图：segs 是 /api/files/ 后面按 / 切开并解码的各段。
 * - ["b", ...pathname]：私有 Blob，用 BLOB_READ_WRITE_TOKEN 读
 * - ["bp", host, ...pathname]：公开 Blob，服务端直接下载（只允许 *.public.blob.vercel-storage.com）
 */
export async function readBlob(segs: string[]): Promise<{ mime: string; body: ReadableStream<Uint8Array> } | null> {
  if (segs[0] === "b") {
    if (!env.blobToken) return null;
    const pathname = segs.slice(1).join("/");
    if (!pathname.startsWith("prism/")) return null;
    const { get } = await import("@vercel/blob");
    const r = await get(pathname, { access: "private", token: env.blobToken });
    if (!r || !r.stream) return null;
    return { mime: r.blob.contentType || "image/png", body: r.stream };
  }
  const host = segs[1] || "";
  if (!BLOB_PUBLIC_HOST.test(host)) return null;
  const pathname = segs.slice(2).map(encodeURIComponent).join("/");
  // 测试用：把公开 Blob 的请求转到本地模拟服务
  const base = process.env.PRISM_TEST_BLOB_ORIGIN ? `${process.env.PRISM_TEST_BLOB_ORIGIN}/${host}` : `https://${host}`;
  const res = await fetch(`${base}/${pathname}`, { signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!res || !res.ok || !res.body) return null;
  return { mime: res.headers.get("content-type")?.split(";")[0] || "image/png", body: res.body };
}

const REMOTE_MAX = 20 * 1024 * 1024;

/** 内网和保留地址：外链代理不允许访问，防止被拿来探测内网 */
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith("::ffff:")) return isPrivateIp(x.slice(7));
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80");
}

/** 测试用：PRISM_ALLOW_PRIVATE_IMAGE_FETCH=1 放行所有内网地址，或者写成 "127.0.0.1:9100,..." 只放行这几个 host:port */
function privateAllowed(u: URL) {
  const v = (process.env.PRISM_ALLOW_PRIVATE_IMAGE_FETCH || "").trim();
  if (!v) return false;
  if (v === "1") return true;
  return v
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .includes(u.host.toLowerCase());
}

async function assertPublicHost(u: URL) {
  if (privateAllowed(u)) return;
  const h = u.hostname.replace(/^\[|\]$/g, "");
  const ips = net.isIP(h) ? [h] : (await lookup(h, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(isPrivateIp)) throw new Error("不允许访问内网地址");
}

/**
 * 服务端下载外部图片（上游生图返回的临时链接、旧数据里的外链、模型回答里的图片）。
 * guardPrivate：给浏览器用的外链代理要拦住内网地址，重定向的每一跳都检查。
 * 只接受 image/* 内容，最大 20MB，20 秒超时。
 */
export async function fetchRemoteImage(url: string, opts: { guardPrivate?: boolean } = {}): Promise<{ mime: string; data: Buffer }> {
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    let u: URL;
    try {
      u = new URL(cur);
    } catch {
      throw new Error("图片地址无效");
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("图片地址无效");
    if (opts.guardPrivate) await assertPublicHost(u);
    const res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(20000), headers: { accept: "image/*,*/*;q=0.5" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      cur = new URL(res.headers.get("location")!, u).toString();
      continue;
    }
    if (!res.ok) throw new Error(`下载图片失败：${res.status}`);
    let mime = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
    const len = Number(res.headers.get("content-length") || 0);
    if (len > REMOTE_MAX) throw new Error("图片太大");
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > REMOTE_MAX) throw new Error("图片太大");
    if (!mime.startsWith("image/")) {
      const sniffed = sniffImage(data);
      if (!sniffed) throw new Error("链接返回的不是图片");
      mime = sniffed;
    }
    return { mime, data };
  }
  throw new Error("图片地址重定向次数太多");
}

/** 有的存储返回 application/octet-stream：看文件头认出常见图片格式 */
function sniffImage(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.slice(0, 4).toString() === "GIF8") return "image/gif";
  if (b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

/**
 * 上游生图返回的是临时链接（比如 OpenAI 的 *.blob.core.windows.net）时，服务端立刻下载并存好，返回本站地址。
 * 下载两次都失败时，退回到经本站转发的外链代理地址，浏览器仍然只访问本站。
 */
export async function persistRemoteImage(url: string): Promise<string> {
  for (let i = 0; i < 2; i++) {
    try {
      const f = await resolveImage(url);
      return await saveFile(Buffer.from(f.data, "base64"), f.mime);
    } catch (e) {
      if (i === 1) console.error("[prism] 转存上游图片失败，改用转发地址", (e as Error)?.message || e);
    }
  }
  return localImageUrl(url);
}
