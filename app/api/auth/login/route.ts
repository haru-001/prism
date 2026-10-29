import { cookies } from "next/headers";
import { env } from "@/lib/server/env";
import { kv, P } from "@/lib/server/kv";
import { makeSessionValue, SESSION_COOKIE, storedPasswordHash } from "@/lib/server/auth";
import { safeEqual, verifyPassword } from "@/lib/server/crypto";
import { copy } from "@/lib/copy";
import { readJSON } from "@/lib/server/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJSON<{ password?: string }>(req);
  const pw = body?.password || "";
  const failKey = P + "login:fail";
  const fails = Number((await kv().get<number>(failKey)) || 0);
  if (fails >= 10) return Response.json({ error: copy.login.locked }, { status: 429 });
  let ok = false;
  if (env.accessPassword) ok = safeEqual(pw, env.accessPassword);
  else {
    const h = await storedPasswordHash();
    ok = !!h && verifyPassword(pw, h);
  }
  if (!ok) {
    await kv().incr(failKey, 600);
    return Response.json({ error: copy.login.wrong }, { status: 401 });
  }
  await kv().del(failKey);
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
