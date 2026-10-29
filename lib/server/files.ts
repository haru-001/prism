import "server-only";
import { put } from "@vercel/blob";
import { env } from "./env";
import { kv, P } from "./kv";
import { randomId } from "./crypto";

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * 保存图片：配了 Vercel Blob 就存 Blob；没配就存进 KV，由 /api/files/[id] 输出。
 * 返回可以直接放进 <img src> 的地址。
 */
export async function saveFile(buf: Buffer, mime: string, folder = "images"): Promise<string> {
  const id = randomId(16);
  const ext = EXT[mime] || "bin";
  if (env.blobToken) {
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
  await kv().set(P + "file:" + id, { mime, data: buf.toString("base64") });
  return `/api/files/${id}.${ext}`;
}

export async function readKvFile(id: string): Promise<{ mime: string; data: Buffer } | null> {
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
