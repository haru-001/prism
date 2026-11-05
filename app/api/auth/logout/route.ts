import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { withDb } from "@/lib/server/dbguard";

async function POSTHandler() {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const POST = withDb(POSTHandler);
