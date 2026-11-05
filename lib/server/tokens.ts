import "server-only";
import { env } from "./env";
import { kv, P } from "./kv";
import { newApiToken, randomId, safeEqual } from "./crypto";
import { extractToken, getApiToken } from "./auth";
import { getPricing, tokenUsage } from "./stats";
import type { TokenRecord } from "../types";

/**
 * 多令牌：
 * - 默认令牌（id=default）就是原来的那个，Key 仍存在 prism:token，老的接入方式完全不变
 * - 其他令牌和所有令牌的限制存在 prism:tokens
 * - 环境变量 PRISM_API_TOKEN 是不受限制的管理令牌
 * - 已有的令牌默认不受任何限制
 * 两个键都在内存缓存里，验令牌不查库。
 */
export interface TokenCtx {
  id: string;
  name: string;
  rec?: TokenRecord;
}

export const WEB_TOKEN: TokenCtx = { id: "web", name: "网页聊天" };
export const ENV_TOKEN: TokenCtx = { id: "env", name: "环境变量令牌" };
export const REPLAY_TOKEN: TokenCtx = { id: "replay", name: "日志重放" };

const KEY = P + "tokens";

export async function listTokens(opts?: { fresh?: boolean }): Promise<TokenRecord[]> {
  const [stored, defKey] = await Promise.all([kv().get<TokenRecord[]>(KEY, opts), getApiToken(opts)]);
  const list = stored || [];
  const def = list.find((t) => t.id === "default");
  const out: TokenRecord[] = [{ ...(def || { id: "default", name: "默认令牌", enabled: true, createdAt: 0 }), key: defKey }];
  for (const t of list) if (t.id !== "default") out.push(t);
  return out;
}

async function saveTokens(list: TokenRecord[]) {
  // 默认令牌的 Key 只存在 prism:token
  await kv().set(
    KEY,
    list.map((t) => (t.id === "default" ? { ...t, key: "" } : t)),
  );
}

export function normalizeLimits(input: Record<string, unknown>, base: TokenRecord): TokenRecord {
  const t: TokenRecord = { ...base };
  if ("name" in input) t.name = String(input.name || "").trim().slice(0, 40) || base.name;
  if ("enabled" in input) t.enabled = input.enabled !== false;
  if ("models" in input) {
    const arr = Array.isArray(input.models) ? input.models : String(input.models || "").split(/[,\n，]/);
    const models = [...new Set(arr.map((m) => String(m).trim()).filter(Boolean))].slice(0, 200);
    if (models.length) t.models = models;
    else delete t.models;
  }
  if ("quota" in input) {
    const q = input.quota as { kind?: string; limit?: unknown } | null;
    const limit = Number(q?.limit);
    if (q && (q.kind === "tokens" || q.kind === "cost") && Number.isFinite(limit) && limit > 0) t.quota = { kind: q.kind, limit };
    else delete t.quota;
  }
  if ("expiresAt" in input) {
    const e = Number(input.expiresAt);
    if (Number.isFinite(e) && e > 0) t.expiresAt = e;
    else delete t.expiresAt;
  }
  return t;
}

export async function createToken(input: Record<string, unknown>): Promise<TokenRecord> {
  const list = await listTokens({ fresh: true });
  const t = normalizeLimits(input, {
    id: randomId(10),
    name: `令牌 ${list.length + 1}`,
    key: newApiToken(),
    enabled: true,
    createdAt: Date.now(),
  });
  await saveTokens([...list, t]);
  return t;
}

export async function updateToken(id: string, input: Record<string, unknown>): Promise<TokenRecord | null> {
  const list = await listTokens({ fresh: true });
  const i = list.findIndex((t) => t.id === id);
  if (i < 0) return null;
  const t = normalizeLimits(input, list[i]);
  if (input.resetKey) {
    if (id === "default") {
      t.key = newApiToken();
      await kv().set(P + "token", t.key);
    } else t.key = newApiToken();
  }
  list[i] = t;
  await saveTokens(list);
  return t;
}

export async function deleteToken(id: string): Promise<boolean> {
  if (id === "default") return false;
  const list = await listTokens({ fresh: true });
  if (!list.some((t) => t.id === id)) return false;
  await saveTokens(list.filter((t) => t.id !== id));
  return true;
}

/** 整体替换（备份恢复用）：同 id 覆盖，其余保留 */
export async function mergeTokens(incoming: TokenRecord[]) {
  const list = await listTokens({ fresh: true });
  const map = new Map(list.map((t) => [t.id, t]));
  for (const t of incoming) {
    if (!t?.id || typeof t.key !== "string") continue;
    if (t.id === "default" && t.key) await kv().set(P + "token", t.key);
    map.set(t.id, { ...t });
  }
  await saveTokens([...map.values()]);
}

/** 验令牌：返回是哪个令牌（无效时返回 null） */
export async function authToken(req: Request): Promise<TokenCtx | null> {
  const k = extractToken(req);
  if (!k) return null;
  if (env.apiToken && safeEqual(k, env.apiToken)) return ENV_TOKEN;
  const find = (list: TokenRecord[]) => list.find((t) => t.key && safeEqual(k, t.key));
  // 缓存里对不上：可能刚在别的实例新建/重置过，直接读库再比一次
  const t = find(await listTokens()) || find(await listTokens({ fresh: true }));
  return t ? { id: t.id, name: t.name, rec: t } : null;
}

export function modelAllowed(rec: TokenRecord | undefined, model: string): boolean {
  if (!rec?.models?.length) return true;
  const m = model.replace(/^models\//, "");
  return rec.models.some((p) => (p.endsWith("*") ? m.startsWith(p.slice(0, -1)) : p === m));
}

export interface Deny {
  status: number;
  type: string;
  message: string;
}

/** 检查令牌限制：停用 / 过期 / 模型不在允许范围 / 额度用完。都通过返回 null */
export async function tokenDeny(ctx: TokenCtx, model: string): Promise<Deny | null> {
  const t = ctx.rec;
  if (!t) return null;
  if (!t.enabled) return { status: 401, type: "authentication_error", message: `令牌「${t.name}」已停用（This API token is disabled）` };
  if (t.expiresAt && Date.now() > t.expiresAt)
    return { status: 401, type: "authentication_error", message: `令牌「${t.name}」已于 ${new Date(t.expiresAt).toISOString().slice(0, 16).replace("T", " ")} UTC 过期（This API token has expired）` };
  if (model && !modelAllowed(t, model))
    return {
      status: 403,
      type: "permission_error",
      message: `令牌「${t.name}」不能使用模型 ${model}，允许的模型：${t.models!.join(", ")}（Model not allowed for this token）`,
    };
  if (t.quota) {
    const used = await tokenUsage(t.id);
    if (t.quota.kind === "tokens" && used.tokens >= t.quota.limit)
      return { status: 429, type: "insufficient_quota", message: `令牌「${t.name}」的额度已用完：已用 ${used.tokens} / ${t.quota.limit} tokens（Token quota exceeded）` };
    if (t.quota.kind === "cost" && used.cost >= t.quota.limit) {
      const cur = (await getPricing()).currency;
      return { status: 429, type: "insufficient_quota", message: `令牌「${t.name}」的额度已用完：已用 ${cur}${used.cost.toFixed(4)} / ${cur}${t.quota.limit}（Token quota exceeded）` };
    }
  }
  return null;
}
