import { handleImages, preflight } from "@/lib/server/relay/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 生图慢，单独调大函数最长执行时间（Hobby 开启 Fluid Compute 时上限 300 秒）
export const maxDuration = 300;

// 第二个参数是 Next 的路由上下文，不能直接传给处理函数
export function POST(req: Request) {
  return handleImages(req);
}
export const OPTIONS = preflight;
