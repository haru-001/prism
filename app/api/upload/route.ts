import { guard } from "@/lib/server/auth";
import { saveFile } from "@/lib/server/files";
import { bad } from "@/lib/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OK = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** 聊天附图 / 参考图上传。Vercel 函数请求体上限约 4.5MB，前端会先压缩 */
export async function POST(req: Request) {
  const g = await guard();
  if (g) return g;
  const fd = await req.formData().catch(() => null);
  const f = fd?.get("file");
  if (!f || typeof f === "string") return bad("没有收到文件");
  if (!OK.includes(f.type)) return bad("只支持 PNG / JPG / WebP / GIF 图片");
  if (f.size > 4.4 * 1024 * 1024) return bad("图片太大了（上限约 4.4MB）");
  const url = await saveFile(Buffer.from(await f.arrayBuffer()), f.type, "uploads");
  return Response.json({ url });
}
