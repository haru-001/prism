import { guard } from "@/lib/server/auth";
import { runUiChat } from "@/lib/server/ui/chat";
import { withDb } from "@/lib/server/dbguard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function POSTHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  return runUiChat(req);
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const POST = withDb(POSTHandler);
