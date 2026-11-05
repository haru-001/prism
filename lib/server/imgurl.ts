import "server-only";
import { hmac, safeEqual } from "./crypto";
import type { Conversation, GalleryItem } from "../types";

/**
 * 浏览器看到的图片一律是本站地址 /api/files/...，由服务端去读 MySQL / Blob / 外链再转发：
 * - /api/files/{id}.{ext}          存在 MySQL（或本地 .data）里的图
 * - /api/files/b/{pathname}        私有 Blob 里的图
 * - /api/files/bp/{host}/{path}    公开 Blob 里的图（服务端去读，浏览器不直连 *.public.blob.vercel-storage.com）
 * - /api/files/ext?u={原地址}      其他外链（旧数据里的上游临时链接、模型回答里的图片），服务端代为下载
 *
 * 每个地址都带 s= 签名（用 PRISM_SECRET 算的 HMAC）。有签名就能打开（给 API 客户端、导出的 Markdown 用），
 * 也能放进 CDN 缓存；没签名的只有登录后才能打开，且只让浏览器自己缓存。
 */

export const FILES = "/api/files/";
export const BLOB_PUBLIC_HOST = /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i;

const sigCache = new Map<string, string>();
export function imgSig(key: string): string {
  let s = sigCache.get(key);
  if (!s) {
    s = hmac("img:" + key).slice(0, 22);
    if (sigCache.size > 5000) sigCache.clear();
    sigCache.set(key, s);
  }
  return s;
}

/** 签名覆盖的内容：站内路径（解码后，不含查询参数）；外链代理是 ext: 加原地址。缩略图参数 w 不参与签名 */
export function sigKey(pathname: string, u: string | null): string {
  let p = pathname;
  try {
    p = decodeURIComponent(pathname);
  } catch {}
  return p === FILES + "ext" ? "ext:" + (u || "") : p;
}

export function verifyImgSig(pathname: string, sp: URLSearchParams): boolean {
  const s = sp.get("s");
  if (!s) return false;
  return safeEqual(s, imgSig(sigKey(pathname, sp.get("u"))));
}

/**
 * 把任意图片地址改写成带签名的本站地址。可以重复调用（已经是本站地址的会重新签一次）。
 * data: 内联图原样返回；不认识的相对地址（比如 /img/ 下的静态图）原样返回。
 */
export function localImageUrl(u: string): string {
  if (typeof u !== "string" || !u) return u;
  if (u.startsWith("data:") || u.startsWith("blob:")) return u;
  let path: string;
  let params: URLSearchParams;
  if (/^https?:\/\//i.test(u)) {
    let x: URL;
    try {
      x = new URL(u);
    } catch {
      return u;
    }
    if (BLOB_PUBLIC_HOST.test(x.hostname)) {
      path = FILES + "bp/" + x.hostname.toLowerCase() + x.pathname;
      params = new URLSearchParams();
    } else {
      path = FILES + "ext";
      params = new URLSearchParams({ u });
    }
  } else if (u.startsWith(FILES)) {
    const q = u.indexOf("?");
    path = q < 0 ? u : u.slice(0, q);
    params = new URLSearchParams(q < 0 ? "" : u.slice(q + 1));
  } else return u;
  params.delete("s");
  params.delete("w");
  params.set("s", imgSig(sigKey(path, params.get("u"))));
  return path + "?" + params.toString();
}

/** 站内地址补成完整链接（给 API 客户端、导出文件用） */
export function absoluteImageUrl(u: string, origin: string): string {
  const l = localImageUrl(u);
  return l.startsWith("/") ? origin + l : l;
}

export function localizeConversation<T extends Conversation | null | undefined>(c: T): T {
  if (!c || !Array.isArray(c.messages)) return c;
  let changed = false;
  const messages = c.messages.map((m) => {
    if (!m.images?.length) return m;
    const images = m.images.map(localImageUrl);
    if (images.every((x, i) => x === m.images![i])) return m;
    changed = true;
    return { ...m, images };
  });
  return (changed ? { ...c, messages } : c) as T;
}

export function localizeGallery(items: GalleryItem[]): GalleryItem[] {
  return items.map((g) => {
    const url = localImageUrl(g.url);
    return url === g.url ? g : { ...g, url };
  });
}

/** 对外看到的站点地址：优先用代理传来的 Host（绑了自己的域名时就是那个域名） */
export function publicOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host");
  if (host) return `${(req.headers.get("x-forwarded-proto") || "https").split(",")[0].trim()}://${host.split(",")[0].trim()}`;
  return url.origin;
}
