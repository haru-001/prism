import "server-only";
import { cookies } from "next/headers";
import { env } from "./env";
import { kv, P } from "./kv";
import { hmac, newApiToken, safeEqual, sha } from "./crypto";

export const SESSION_COOKIE = "prism_session";
const SESSION_DAYS = 30;

export async function storedPasswordHash(): Promise<string | null> {
  return kv().get<string>(P + "auth:pw");
}

export async function passwordConfigured(): Promise<boolean> {
  if (env.accessPassword) return true;
  return !!(await storedPasswordHash());
}

async function fingerprint(): Promise<string> {
  if (env.accessPassword) return "env:" + sha(env.accessPassword);
  const h = await storedPasswordHash();
  return h ? "kv:" + sha(h) : "none";
}

export async function makeSessionValue(): Promise<{ value: string; maxAge: number }> {
  const maxAge = SESSION_DAYS * 86400;
  const exp = Date.now() + maxAge * 1000;
  const fp = await fingerprint();
  return { value: `${exp}.${hmac(`${exp}.${fp}`)}`, maxAge };
}

export async function verifySessionValue(value?: string | null): Promise<boolean> {
  if (!value) return false;
  const [expS, sig] = value.split(".");
  const exp = Number(expS);
  if (!exp || exp < Date.now() || !sig) return false;
  const fp = await fingerprint();
  if (fp === "none") return false;
  return safeEqual(sig, hmac(`${exp}.${fp}`));
}

/** 给 Server Component / Route Handler 用 */
export async function isAuthed(): Promise<boolean> {
  const c = await cookies();
  return verifySessionValue(c.get(SESSION_COOKIE)?.value);
}

export function unauthorized() {
  return Response.json({ error: "未登录或登录已过期" }, { status: 401 });
}

/** 内部 /api 接口的登录校验，失败返回 401 响应 */
export async function guard(): Promise<Response | null> {
  return (await isAuthed()) ? null : unauthorized();
}

// ===== 对外令牌 =====
export async function getApiToken(): Promise<string> {
  let t = await kv().get<string>(P + "token");
  if (!t) {
    t = newApiToken();
    await kv().set(P + "token", t);
  }
  return t;
}

export async function resetApiToken(): Promise<string> {
  const t = newApiToken();
  await kv().set(P + "token", t);
  return t;
}

/** 从请求里取令牌：Authorization Bearer / x-api-key / x-goog-api-key / ?key= */
export function extractToken(req: Request): string {
  const h = req.headers;
  const auth = h.get("authorization") || "";
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  const x = h.get("x-api-key") || h.get("x-goog-api-key") || h.get("api-key");
  if (x) return x.trim();
  try {
    return new URL(req.url).searchParams.get("key") || "";
  } catch {
    return "";
  }
}

export async function verifyApiToken(req: Request): Promise<boolean> {
  const t = extractToken(req);
  if (!t) return false;
  if (env.apiToken && safeEqual(t, env.apiToken)) return true;
  const stored = await getApiToken();
  return safeEqual(t, stored);
}
