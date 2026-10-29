import "server-only";
import { put } from "@vercel/blob";
import { env } from "./env";
import { kv, P, storageKind } from "./kv";
import { randomId } from "./crypto";
import { q, T } from "./mysql";
import type { RowDataPacket } from "mysql2/promise";

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * 保存图片，返回可以直接放进 <img src> 的地址：
 * - 配了 Vercel Blob：存 Blob
 * - 用 MySQL（Aiven）：压缩后存进 prism_files 表，总量超过 DB_IMAGES_MAX_MB 时删掉最早的图
 * - 本地开发：存进 .data/kv.json
 * 后两种由 /api/files/[id] 输出。
 */
export async function saveFile(buf: Buffer, mime: string, folder = "images"): Promise<string> {
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
  if (ids.length) await q(`DELETE FROM ${T.files} WHERE id IN (?)`, [ids]);
  return ids.length;
}

/** 站内图片地址 /api/files/{id}.{ext} 里的 id；Blob 和外链返回 null */
export function localFileId(url: string): string | null {
  if (!url.startsWith("/api/files/") || url.startsWith("/api/files/b/")) return null;
  return url.slice("/api/files/".length).split(".")[0] || null;
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

export async function readKvFile(id: string): Promise<{ mime: string; data: Buffer } | null> {
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
  if (url.startsWith("/api/files/b/")) {
    const { get } = await import("@vercel/blob");
    const pathname = decodeURIComponent(url.slice("/api/files/b/".length));
    const r = await get(pathname, { access: "private", token: env.blobToken });
    if (!r || !r.stream) throw new Error("图片不存在");
    const buf = Buffer.from(await new Response(r.stream).arrayBuffer());
    return { data: buf.toString("base64"), mime: r.blob.contentType || "image/png" };
  }
  if (url.startsWith("/api/files/")) {
    const id = url.slice("/api/files/".length).split(".")[0];
    const f = await readKvFile(id);
    if (!f) throw new Error("图片不存在");
    return { data: f.data.toString("base64"), mime: f.mime };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载图片失败：${res.status}`);
  const mime = res.headers.get("content-type")?.split(";")[0] || "image/png";
  return { data: Buffer.from(await res.arrayBuffer()).toString("base64"), mime };
}
