import { fetchRemoteImage, readBlob, readKvFile } from "@/lib/server/files";
import { isAuthed } from "@/lib/server/auth";
import { verifyImgSig } from "@/lib/server/imgurl";
import { withDb } from "@/lib/server/dbguard";

export const runtime = "nodejs";

/** 缩略图允许的宽度（左栏/消息里的小图用，省流量、加载快） */
const WIDTHS = new Set([256, 512, 1024]);

/** 图片响应不执行任何脚本（防止有人拿外链代理转发带脚本的 SVG） */
const SAFE = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
};

function fail(status: number, text: string) {
  return new Response(text, { status, headers: { "Cache-Control": "no-store", ...SAFE } });
}

/**
 * 站内图片转发（浏览器只访问本站，不直连 Blob 或任何外部域名）：
 * - /api/files/{id}.{ext}：没配 Blob 时存在数据库里的图
 * - /api/files/b/{pathname}：私有 Blob 里的图
 * - /api/files/bp/{host}/{pathname}：公开 Blob 里的图
 * - /api/files/ext?u=...：外链图片（旧数据里的上游链接、模型回答里的图），服务端代为下载，不访问内网
 * - 加 ?w=256|512|1024 返回缩小的 WebP 缩略图
 *
 * 鉴权：带正确签名 s= 的地址谁都能打开（API 客户端、导出的 Markdown 要用），浏览器和 Vercel CDN 缓存一年；
 * 没有签名时必须已登录，响应只让浏览器自己缓存（private），免得 CDN 把它缓存给未登录的人。
 */
async function GETHandler(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = new URL(req.url);
  const sp = url.searchParams;
  const signed = verifyImgSig(url.pathname, sp);
  if (!signed && !(await isAuthed())) return fail(401, "Unauthorized");

  const w = Number(sp.get("w"));
  const width = WIDTHS.has(w) ? w : 0;
  const kind = path[0] === "ext" ? "ext" : path[0] === "b" || path[0] === "bp" ? "blob" : "db";
  // 外链的内容不归我们管，只缓存 7 天；站内图片内容永远不变，缓存一年
  const maxAge = kind === "ext" ? 7 * 86400 : 31536000;
  const cache = `${signed ? "public" : "private"}, max-age=${maxAge}, immutable`;
  const headers: Record<string, string> = { "Cache-Control": cache, ...SAFE };
  if (signed) headers["CDN-Cache-Control"] = cache;

  let body: Uint8Array | ReadableStream | null = null;
  let type = "image/png";
  if (kind === "ext") {
    const u = sp.get("u") || "";
    try {
      const f = await fetchRemoteImage(u, { guardPrivate: true });
      type = f.mime;
      body = new Uint8Array(f.data);
    } catch (e) {
      return fail(502, `图片下载失败：${(e as Error)?.message || e}`);
    }
  } else if (kind === "blob") {
    const r = await readBlob(path).catch(() => null);
    if (!r) return fail(404, "Not found");
    type = r.mime;
    body = r.body;
  } else {
    const id = (path[0] || "").split(".")[0];
    const f = await readKvFile(id);
    if (!f) return fail(404, "Not found");
    type = f.mime;
    body = new Uint8Array(f.data);
  }

  if (width) {
    if (body instanceof ReadableStream) body = new Uint8Array(await new Response(body).arrayBuffer());
    const thumb = await thumbnail(body, width);
    if (thumb) return new Response(new Uint8Array(thumb), { headers: { ...headers, "Content-Type": "image/webp" } });
  }
  return new Response(body as BodyInit, { headers: { ...headers, "Content-Type": type } });
}

async function thumbnail(src: Uint8Array, width: number): Promise<Buffer | null> {
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(Buffer.from(src)).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  } catch {
    return null;
  }
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const GET = withDb(GETHandler);
