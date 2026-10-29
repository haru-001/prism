import { cookies } from "next/headers";
import { env } from "@/lib/server/env";
import { kv, P } from "@/lib/server/kv";
import { isAuthed, makeSessionValue, passwordConfigured, SESSION_COOKIE } from "@/lib/server/auth";
import { hashPassword } from "@/lib/server/crypto";
import { bad, readJSON } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/** 首次引导设访问密码；已登录时也可用来修改（环境变量里设了密码时不允许） */
export async function POST(req: Request) {
  if (env.accessPassword) return bad("访问密码由环境变量 ACCESS_PASSWORD 管理，请到 Vercel 里修改", 409);
  if ((await passwordConfigured()) && !(await isAuthed())) return bad("请先登录", 401);
  const body = await readJSON<{ password?: string }>(req);
  const pw = (body?.password || "").trim();
  if (pw.length < 6) return bad("密码至少 6 位");
  await kv().set(P + "auth:pw", hashPassword(pw));
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
