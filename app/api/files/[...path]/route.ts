import { env } from "@/lib/server/env";
import { readKvFile } from "@/lib/server/files";

export const runtime = "nodejs";

/**
 * 图片输出：
 * - /api/files/{id}.{ext}：没配 Blob 时存在 KV 里的图
 * - /api/files/b/{pathname}：私有 Blob 存储里的图
 * 文件名是随机长 ID，不可枚举；不校验登录是为了方便下载和外链。
 */
export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const headers = { "Cache-Control": "public, max-age=31536000, immutable" };
  if (path[0] === "b" && env.blobToken) {
    const { get } = await import("@vercel/blob");
    const pathname = decodeURIComponent(path.slice(1).join("/"));
    if (!pathname.startsWith("prism/")) return new Response("Not found", { status: 404 });
    const r = await get(pathname, { access: "private", token: env.blobToken });
    if (!r || !r.stream) return new Response("Not found", { status: 404 });
    return new Response(r.stream, { headers: { ...headers, "Content-Type": r.blob.contentType || "image/png" } });
  }
  const id = (path[0] || "").split(".")[0];
  const f = await readKvFile(id);
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(f.data), { headers: { ...headers, "Content-Type": f.mime } });
}
