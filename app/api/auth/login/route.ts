import { cookies } from "next/headers";
import { env } from "@/lib/server/env";
import { kv, P } from "@/lib/server/kv";
import { makeSessionValue, SESSION_COOKIE, storedPasswordHash } from "@/lib/server/auth";
import { safeEqual, sha, verifyPassword } from "@/lib/server/crypto";
import { copy } from "@/lib/copy";
import { readJSON } from "@/lib/server/api";
import { withDb } from "@/lib/server/dbguard";

export const dynamic = "force-dynamic";

/**
 * 客户端 IP：Vercel 上 x-real-ip / x-vercel-forwarded-for 由平台写入，客户端改不了；
 * 自建时取 x-forwarded-for 的第一个。都没有就归到同一个桶里。
 */
function clientIp(req: Request): string {
  const h = req.headers;
  const ip = h.get("x-vercel-forwarded-for") || h.get("x-real-ip") || h.get("x-forwarded-for") || "";
  return ip.split(",")[0].trim() || "unknown";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function POSTHandler(req: Request) {
  const body = await readJSON<{ password?: string }>(req);
  const pw = body?.password || "";
  // 失败次数按 IP 分开计：别人在自己那边输错，不会把你锁在外面
  const failKey = P + "login:fail:" + sha(clientIp(req)).slice(0, 16);
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
    await sleep(400); // 每次失败稍微慢一点，拖慢换 IP 暴力尝试
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
