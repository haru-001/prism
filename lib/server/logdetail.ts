import "server-only";
import { kv, P, storageKind } from "./kv";
import { q, T } from "./mysql";
import type { LogDetail } from "../types";

/**
 * 日志详情（完整请求 + 响应）：
 * - 和日志一样只留最近 500 条
 * - 单条体积受控：长字符串截断、base64 图片换成占位，请求体最多 24KB、响应体最多 16KB
 * - Authorization / x-api-key / Cookie 等敏感头和请求体里的 key 字段一律打码
 * - 在响应发完之后异步写入，不占请求时间
 */
export const DETAIL_LIMIT = 500;
export const REQ_MAX = 24 * 1024;
export const RES_MAX = 16 * 1024;
const STR_MAX = 4000;
const LOCAL_KEY = P + "logd";

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|x-api-key|x-goog-api-key|api-key|cookie|set-cookie|x-prism-.*|x-vercel-.*|x-forwarded-for|x-real-ip|cf-connecting-ip)$/i;
const SENSITIVE_FIELD = /^(api[_-]?key|key|token|access[_-]?token|secret|password|authorization)$/i;

export function mask(v: string): string {
  if (!v) return v;
  const s = v.replace(/^bearer\s+/i, "");
  const pre = v.length !== s.length ? v.slice(0, v.length - s.length) : "";
  if (s.length <= 8) return pre + "****";
  return `${pre}${s.slice(0, 4)}****${s.slice(-4)}`;
}

export function maskHeaders(h: Headers | Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const entries = h instanceof Headers ? [...h.entries()] : Object.entries(h);
  for (const [k, v] of entries) {
    if (/^(x-vercel-|x-forwarded-for|x-real-ip|cf-connecting-ip|x-middleware-|next-|rsc$)/i.test(k)) continue;
    out[k] = SENSITIVE_HEADER.test(k) ? mask(v) : v.length > 300 ? v.slice(0, 300) + "…" : v;
  }
  return out;
}

/** 把 JSON 里的大字符串截断、图片换成占位、敏感字段打码；返回是否动过内容 */
export function sanitize(v: unknown): { value: unknown; changed: boolean } {
  let changed = false;
  const walk = (x: unknown, key = ""): unknown => {
    if (typeof x === "string") {
      if (SENSITIVE_FIELD.test(key) && x) {
        changed = true;
        return mask(x);
      }
      const m = /^data:([\w/+.-]+);base64,/.exec(x);
      if (m) {
        changed = true;
        return `[${m[1]} 图片，约 ${Math.round((x.length * 3) / 4 / 1024)} KB，已省略]`;
      }
      if ((key === "data" || key === "b64_json" || key === "bytesBase64Encoded") && x.length > 512 && /^[A-Za-z0-9+/=\s]+$/.test(x.slice(0, 512))) {
        changed = true;
        return `[base64 数据，约 ${Math.round((x.length * 3) / 4 / 1024)} KB，已省略]`;
      }
      if (x.length > STR_MAX) {
        changed = true;
        return `${x.slice(0, STR_MAX)}…（已截断，原长 ${x.length} 字）`;
      }
      return x;
    }
    if (Array.isArray(x)) {
      if (x.length > 200) {
        changed = true;
        return [...x.slice(0, 200).map((i) => walk(i)), `…（还有 ${x.length - 200} 项，已省略）`];
      }
      return x.map((i) => walk(i));
    }
    if (x && typeof x === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x)) o[k] = walk(val, k);
      return o;
    }
    return x;
  };
  return { value: walk(v), changed };
}

/** 请求体：JSON 先清理再美化；超长整体截断 */
export function packRequestBody(raw: string): { body: string; truncated: boolean } {
  if (!raw) return { body: "", truncated: false };
  let body = raw;
  let truncated = false;
  try {
    const { value, changed } = sanitize(JSON.parse(raw));
    body = JSON.stringify(value, null, 2);
    truncated = changed;
  } catch {
    /* 不是 JSON，原样存 */
  }
  if (body.length > REQ_MAX) {
    body = body.slice(0, REQ_MAX) + `\n…（已截断，原长 ${body.length} 字）`;
    truncated = true;
  }
  return { body, truncated };
}

/** 响应体：JSON 清理后美化，流式（SSE）原样保留；超长截断 */
export function packResponseBody(raw: string, cut: boolean): string {
  let body = raw;
  if (!cut) {
    try {
      body = JSON.stringify(sanitize(JSON.parse(raw)).value, null, 2);
    } catch {
      /* SSE 或纯文本 */
    }
  }
  body = body.replace(/data:([\w/+.-]+);base64,[A-Za-z0-9+/=]{200,}/g, (_m, t) => `[${t} 图片，已省略]`);
  if (body.length > RES_MAX) return body.slice(0, RES_MAX) + `\n…（已截断，原长 ${body.length} 字）`;
  return cut ? body + "\n…（响应很长，只保留了开头）" : body;
}

export async function saveDetail(d: LogDetail) {
  const v = JSON.stringify(d);
  if (storageKind() === "mysql") {
    await q(`INSERT INTO ${T.logd} (id, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)`, [d.id, v]);
    // 只留最新 500 条左右：和日志列表一样，大约每 16 次写入修剪一次，省掉每次请求一条 DELETE
    if (Math.random() < 1 / 16) await q(
      `DELETE FROM ${T.logd} WHERE seq < (SELECT s FROM (SELECT seq s FROM ${T.logd} ORDER BY seq DESC LIMIT 1 OFFSET ${DETAIL_LIMIT - 1}) x)`,
    );
  } else {
    await kv().hset(LOCAL_KEY, d.id, d);
    const all = await kv().hgetall<LogDetail>(LOCAL_KEY);
    const ids = Object.values(all).sort((a, b) => b.at - a.at);
    for (const x of ids.slice(DETAIL_LIMIT)) await kv().hdel(LOCAL_KEY, x.id);
  }
}

export async function getDetail(id: string): Promise<LogDetail | null> {
  if (storageKind() === "mysql") {
    const rows = await q<{ v: string }[]>(`SELECT v FROM ${T.logd} WHERE id = ?`, [id]);
    return rows[0] ? (JSON.parse(rows[0].v) as LogDetail) : null;
  }
  return kv().hget<LogDetail>(LOCAL_KEY, id);
}

export async function clearDetails() {
  if (storageKind() === "mysql") await q(`DELETE FROM ${T.logd}`);
  else await kv().del(LOCAL_KEY);
}

export async function countDetails(): Promise<number> {
  if (storageKind() === "mysql") {
    const rows = await q<{ c: number }[]>(`SELECT COUNT(*) c FROM ${T.logd}`);
    return Number(rows[0]?.c || 0);
  }
  return Object.keys(await kv().hgetall(LOCAL_KEY)).length;
}
