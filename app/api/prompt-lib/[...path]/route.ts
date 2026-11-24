import { isAuthed } from "@/lib/server/auth";
import { getLibManifest, readBundledFile, readSyncedFile } from "@/lib/server/promptlib";
import { IMG_BASE } from "@/lib/server/promptlib/build";
import { fetchRemoteImage } from "@/lib/server/files";
import { withDb } from "@/lib/server/dbguard";

export const runtime = "nodejs";

const FOREVER_PRIVATE = "private, max-age=31536000, immutable";
/** 封面是公开图床上的图，内容按路径固定：CDN 和浏览器都缓存一年 */
const FOREVER_PUBLIC = "public, max-age=31536000, s-maxage=31536000, immutable";
const WIDTHS = new Set([360, 720]);

function gz(buf: Buffer) {
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "application/octet-stream", "Cache-Control": FOREVER_PRIVATE, "X-Content-Type-Options": "nosniff" },
  });
}
const nf = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * 提示词库的数据和封面：
 * - manifest              当前清单（数据更新后用它刷新）
 * - d/{版本}/{文件}        同步来的水仙库数据（index / py / p0…）
 * - r18/p{n}、as/ex        R18 库（只在确认已满 18 岁、打开 R18 时才请求）
 * - img/{图床路径}?w=360   封面缩略图：服务端从水仙库图床取图、压成 WebP，浏览器只访问本站
 */
async function GETHandler(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const [kind, ...rest] = path;

  if (kind === "img") {
    const p = rest.map(decodeURIComponent).join("/");
    if (!/^[\w\-./]+\.(jpe?g|png|webp|gif)$/i.test(p) || p.includes("..")) return nf();
    const w = Number(new URL(req.url).searchParams.get("w"));
    try {
      const im = await fetchRemoteImage(IMG_BASE + p);
      let body: Buffer = im.data;
      let type = im.mime;
      if (WIDTHS.has(w) && type !== "image/gif") {
        try {
          const sharp = (await import("sharp")).default;
          body = await sharp(im.data, { failOn: "none" }).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();
          type = "image/webp";
        } catch {
          /* 压缩失败就给原图 */
        }
      }
      return new Response(new Uint8Array(body), {
        headers: {
          "Content-Type": type,
          "Cache-Control": FOREVER_PUBLIC,
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    } catch (e) {
      return new Response((e as Error).message, { status: 502, headers: { "Cache-Control": "public, max-age=300" } });
    }
  }

  if (!(await isAuthed())) return new Response("Unauthorized", { status: 401 });
  if (kind === "manifest") return Response.json(await getLibManifest(), { headers: { "Cache-Control": "no-store" } });
  if (kind === "d" && rest.length === 2) {
    const buf = await readSyncedFile(rest[0], rest[1].replace(/\.json\.gz$/, ""));
    return buf ? gz(buf) : nf();
  }
  if ((kind === "r18" || kind === "as") && rest.length === 1) {
    const buf = await readBundledFile(kind, rest[0].replace(/\.json\.gz$/, ""));
    return buf ? gz(buf) : nf();
  }
  return nf();
}

export const GET = withDb(GETHandler);
