import { handleOpenAIChat, preflight } from "@/lib/server/relay/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 第二个参数是 Next 的路由上下文，不能直接传给处理函数
export function POST(req: Request) {
  return handleOpenAIChat(req);
}
export const OPTIONS = preflight;
