import { cookies } from "next/headers";
import { env } from "@/lib/server/env";
import { kv, P } from "@/lib/server/kv";
import { makeSessionValue, SESSION_COOKIE, storedPasswordHash } from "@/lib/server/auth";
import { safeEqual, verifyPassword } from "@/lib/server/crypto";
import { copy } from "@/lib/copy";
import { readJSON } from "@/lib/server/api";
import { withDb } from "@/lib/server/dbguard";

export const dynamic = "force-dynamic";

async function POSTHandler(req: Request) {
  const body = await readJSON<{ password?: string }>(req);
  const pw = body?.password || "";
  const failKey = P + "login:fail";
  // 失败计数和密码哈希一次读回来（原来是两次串行查询）
  const vals = await kv().mget(env.accessPassword ? [failKey] : [failKey, P + "auth:pw"], { fresh: true });
  const fails = Number(vals[failKey] || 0);
  if (fails >= 10) return Response.json({ error: copy.login.locked }, { status: 429 });
  let ok = false;
  if (env.accessPassword) ok = safeEqual(pw, env.accessPassword);
  else {
    const h = (vals[P + "auth:pw"] as string | null) ?? (await storedPasswordHash());
    ok = !!h && verifyPassword(pw, h);
  }
  if (!ok) {
    await kv().incr(failKey, 600);
    return Response.json({ error: copy.login.wrong }, { status: 401 });
  }
  if (fails > 0) await kv().del(failKey);
  const s = await makeSessionValue();
  (await cookies()).set(SESSION_COOKIE, s.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    maxAge: s.maxAge,
  });
  return Response.json({ ok: true });
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const POST = withDb(POSTHandler);
