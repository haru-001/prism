import { cookies } from "next/headers";
import { env } from "@/lib/server/env";
import { kv, P } from "@/lib/server/kv";
import { checkSetupCode, isAuthed, storedPasswordHash, makeSessionValue, passwordConfigured, SESSION_COOKIE } from "@/lib/server/auth";
import { hashPassword } from "@/lib/server/crypto";
import { bad, readJSON } from "@/lib/server/api";
import { withDb } from "@/lib/server/dbguard";

export const dynamic = "force-dynamic";

/** 首次引导设访问密码；已登录时也可用来修改（环境变量里设了密码时不允许） */
async function POSTHandler(req: Request) {
  if (env.accessPassword) return bad("访问密码由环境变量 ACCESS_PASSWORD 管理，请到 Vercel 里修改", 409);
  const configured = await passwordConfigured();
  if (configured && !(await isAuthed())) return bad("请先登录", 401);
  const body = await readJSON<{ password?: string; setupCode?: string }>(req);
  const pw = (body?.password || "").trim();
  if (pw.length < 6) return bad("密码至少 6 位");
  if (!configured) {
    // 首次设密码：要先核对初始化口令，防止站点刚部署时被路人抢先设密码
    if (!checkSetupCode(body?.setupCode)) return bad("初始化口令不对。口令是 Vercel 环境变量里的 PRISM_SETUP_CODE，没设的话就是 PRISM_SECRET", 403);
    // 两个请求同时首次设密码时只放行一个
    const n = await kv().incr(P + "auth:setup-lock", 30);
    if (n > 1) return bad("正在设置访问密码，请刷新页面后登录", 409);
    if (await storedPasswordHash({ fresh: true })) return bad("访问密码已经设过了，请直接登录", 409);
  }
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

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const POST = withDb(POSTHandler);
