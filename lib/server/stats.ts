import "server-only";
import { kv, P, storageKind } from "./kv";
import { q, T } from "./mysql";
import type { LogEntry, PriceRule, Pricing } from "../types";

/**
 * 用量统计：按「天 × 模型 × 渠道 × 令牌」聚合。
 * - 写入跟日志一起在响应发出之后异步进行，不占请求时间
 * - MySQL 里用 INSERT ... ON DUPLICATE KEY UPDATE 原子累加，一条请求一条 SQL
 * - 金额不存库，查询时按当前单价估算：改了单价，历史花费也跟着重算
 * - 只留最近 400 天
 */
export interface UsageRow {
  day: string;
  model: string;
  channel: string;
  token: string;
  requests: number;
  fails: number;
  inTok: number;
  outTok: number;
}

const KEEP_DAYS = 400;
const LOCAL_KEY = P + "usage";

/** 本地时区的日期（用 TZ 环境变量控制；统计按这个日期分天） */
export function dayOf(ts: number, tz = statsTz()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}
export function statsTz() {
  return process.env.PRISM_TZ || "Asia/Shanghai";
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** 记一条用量（由 addLog 在后台调用） */
export async function recordUsage(e: Pick<LogEntry, "at" | "model" | "channel" | "tokenId" | "ok" | "inTokens" | "outTokens">) {
  const row: UsageRow = {
    day: dayOf(e.at),
    model: clip(e.model || "-", 160),
    channel: clip(e.channel || "-", 120),
    token: clip(e.tokenId || "-", 64),
    requests: 1,
    fails: e.ok ? 0 : 1,
    inTok: Math.max(0, Math.round(e.inTokens || 0)),
    outTok: Math.max(0, Math.round(e.outTokens || 0)),
  };
  bumpTokenCache(row);
  if (storageKind() === "mysql") {
    await q(
      `INSERT INTO ${T.usage} (day, model, channel, token, requests, fails, in_tok, out_tok) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
       ON DUPLICATE KEY UPDATE requests = requests + 1, fails = fails + VALUES(fails), in_tok = in_tok + VALUES(in_tok), out_tok = out_tok + VALUES(out_tok)`,
      [row.day, row.model, row.channel, row.token, row.fails, row.inTok, row.outTok],
    );
    if (Math.random() < 0.01) await q(`DELETE FROM ${T.usage} WHERE day < ?`, [dayOf(Date.now() - KEEP_DAYS * 86400e3)]).catch(() => {});
  } else {
    const f = [row.day, row.model, row.channel, row.token].join("\t");
    const cur = (await kv().hget<UsageRow>(LOCAL_KEY, f)) || { ...row, requests: 0, fails: 0, inTok: 0, outTok: 0 };
    await kv().hset(LOCAL_KEY, f, { ...cur, requests: cur.requests + 1, fails: cur.fails + row.fails, inTok: cur.inTok + row.inTok, outTok: cur.outTok + row.outTok });
  }
}

/** 读最近 days 天（含今天）的聚合行 */
export async function readUsage(days: number): Promise<UsageRow[]> {
  const from = dayOf(Date.now() - (days - 1) * 86400e3);
  if (storageKind() === "mysql") {
    const rows = await q<{ day: string; model: string; channel: string; token: string; requests: number; fails: number; in_tok: number | string; out_tok: number | string }[]>(
      `SELECT day, model, channel, token, requests, fails, in_tok, out_tok FROM ${T.usage} WHERE day >= ?`,
      [from],
    );
    return rows.map((r) => ({ day: r.day, model: r.model, channel: r.channel, token: r.token, requests: Number(r.requests), fails: Number(r.fails), inTok: Number(r.in_tok), outTok: Number(r.out_tok) }));
  }
  const all = await kv().hgetall<UsageRow>(LOCAL_KEY);
  return Object.values(all).filter((r) => r.day >= from);
}

export async function clearUsage() {
  tokenCache.clear();
  if (storageKind() === "mysql") await q(`DELETE FROM ${T.usage}`);
  else await kv().del(LOCAL_KEY);
}

// ===== 单价 =====

export const DEFAULT_PRICING: Pricing = { currency: "$", rules: [] };

export async function getPricing(opts?: { fresh?: boolean }): Promise<Pricing> {
  const p = await kv().get<Pricing>(P + "pricing", opts);
  return { ...DEFAULT_PRICING, ...(p || {}), rules: p?.rules || [] };
}

export function normalizePricing(input: unknown): Pricing {
  const o = (input || {}) as Partial<Pricing>;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6) / 1e6 : 0;
  };
  const rules: PriceRule[] = [];
  for (const r of Array.isArray(o.rules) ? o.rules : []) {
    const pattern = String(r?.pattern || "").trim().slice(0, 160);
    if (!pattern) continue;
    const rule: PriceRule = { pattern, input: num(r.input), output: num(r.output) };
    if (r.perRequest) rule.perRequest = num(r.perRequest);
    rules.push(rule);
  }
  return { currency: String(o.currency || "$").trim().slice(0, 6) || "$", rules: rules.slice(0, 200) };
}

export async function savePricing(p: Pricing) {
  await kv().set(P + "pricing", p);
  tokenCache.clear();
}

/** 按模型名找单价：精确匹配优先，其次是最长的 * 前缀 */
export function priceFor(p: Pricing, model: string): PriceRule | null {
  const m = model.replace(/^models\//, "");
  let best: PriceRule | null = null;
  let bestLen = -1;
  for (const r of p.rules) {
    if (r.pattern === m) return r;
    if (r.pattern.endsWith("*")) {
      const pre = r.pattern.slice(0, -1);
      if (m.startsWith(pre) && pre.length > bestLen) {
        best = r;
        bestLen = pre.length;
      }
    }
  }
  return best;
}

export function costOf(p: Pricing, r: Pick<UsageRow, "model" | "requests" | "fails" | "inTok" | "outTok">): number {
  const rule = priceFor(p, r.model);
  if (!rule) return 0;
  return (r.inTok * rule.input + r.outTok * rule.output) / 1e6 + (rule.perRequest || 0) * Math.max(0, r.requests - r.fails);
}

// ===== 报表 =====

export interface Bucket {
  key: string;
  requests: number;
  fails: number;
  inTok: number;
  outTok: number;
  cost: number;
}

export async function usageReport(days: number) {
  const [rows, pricing] = await Promise.all([readUsage(days), getPricing()]);
  const add = (map: Map<string, Bucket>, key: string, r: UsageRow, cost: number) => {
    const b = map.get(key) || { key, requests: 0, fails: 0, inTok: 0, outTok: 0, cost: 0 };
    b.requests += r.requests;
    b.fails += r.fails;
    b.inTok += r.inTok;
    b.outTok += r.outTok;
    b.cost += cost;
    map.set(key, b);
  };
  const byDay = new Map<string, Bucket>();
  const byModel = new Map<string, Bucket>();
  const byChannel = new Map<string, Bucket>();
  const byToken = new Map<string, Bucket>();
  const unpriced = new Set<string>();
  for (const r of rows) {
    const cost = costOf(pricing, r);
    if ((r.inTok || r.outTok || r.requests) && !priceFor(pricing, r.model)) unpriced.add(r.model);
    add(byDay, r.day, r, cost);
    add(byModel, r.model, r, cost);
    add(byChannel, r.channel, r, cost);
    add(byToken, r.token, r, cost);
  }
  // 补齐没有请求的日子，趋势图才是连续的
  const daysList: Bucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = dayOf(Date.now() - i * 86400e3);
    daysList.push(byDay.get(d) || { key: d, requests: 0, fails: 0, inTok: 0, outTok: 0, cost: 0 });
  }
  const sorted = (m: Map<string, Bucket>) => [...m.values()].sort((a, b) => b.cost - a.cost || b.inTok + b.outTok - (a.inTok + a.outTok) || b.requests - a.requests);
  const total = daysList.reduce(
    (t, b) => ({ ...t, requests: t.requests + b.requests, fails: t.fails + b.fails, inTok: t.inTok + b.inTok, outTok: t.outTok + b.outTok, cost: t.cost + b.cost }),
    { key: "total", requests: 0, fails: 0, inTok: 0, outTok: 0, cost: 0 } as Bucket,
  );
  return { days: daysList, models: sorted(byModel), channels: sorted(byChannel), tokens: sorted(byToken), total, currency: pricing.currency, unpriced: [...unpriced].sort(), tz: statsTz() };
}

// ===== 令牌已用额度（额度检查用） =====
// 每个实例在内存里缓存各令牌的累计用量 15 秒，本实例产生的用量实时叠加；
// 所以额度检查几乎不查库。多实例时最多有十几秒的滞后，超出一点点是正常的。

const TOKEN_TTL = 15_000;
const g = globalThis as unknown as { __prismTokUse?: Map<string, { at: number; rows: Map<string, UsageRow> }> };
const tokenCache = (g.__prismTokUse ??= new Map());

function bumpTokenCache(r: UsageRow) {
  const c = tokenCache.get(r.token);
  if (!c) return;
  const cur = c.rows.get(r.model) || { ...r, requests: 0, fails: 0, inTok: 0, outTok: 0 };
  c.rows.set(r.model, { ...cur, requests: cur.requests + r.requests, fails: cur.fails + r.fails, inTok: cur.inTok + r.inTok, outTok: cur.outTok + r.outTok });
}

async function loadTokenRows(tokenId: string): Promise<Map<string, UsageRow>> {
  const rows = new Map<string, UsageRow>();
  const push = (r: UsageRow) => {
    const cur = rows.get(r.model) || { ...r, requests: 0, fails: 0, inTok: 0, outTok: 0 };
    rows.set(r.model, { ...cur, requests: cur.requests + r.requests, fails: cur.fails + r.fails, inTok: cur.inTok + r.inTok, outTok: cur.outTok + r.outTok });
  };
  if (storageKind() === "mysql") {
    const res = await q<{ model: string; requests: number | string; fails: number | string; in_tok: number | string; out_tok: number | string }[]>(
      `SELECT model, SUM(requests) requests, SUM(fails) fails, SUM(in_tok) in_tok, SUM(out_tok) out_tok FROM ${T.usage} WHERE token = ? GROUP BY model`,
      [tokenId],
    );
    for (const r of res) push({ day: "", model: r.model, channel: "", token: tokenId, requests: Number(r.requests), fails: Number(r.fails), inTok: Number(r.in_tok), outTok: Number(r.out_tok) });
  } else {
    for (const r of Object.values(await kv().hgetall<UsageRow>(LOCAL_KEY))) if (r.token === tokenId) push(r);
  }
  return rows;
}

/** 某个令牌累计用了多少（token 总量和估算金额） */
export async function tokenUsage(tokenId: string, opts?: { fresh?: boolean }): Promise<{ tokens: number; cost: number }> {
  let c = tokenCache.get(tokenId);
  if (!c || opts?.fresh || Date.now() - c.at > TOKEN_TTL) {
    c = { at: Date.now(), rows: await loadTokenRows(tokenId) };
    tokenCache.set(tokenId, c);
  }
  const pricing = await getPricing();
  let tokens = 0;
  let cost = 0;
  for (const r of c.rows.values()) {
    tokens += r.inTok + r.outTok;
    cost += costOf(pricing, r);
  }
  return { tokens, cost };
}

/** 重置某个令牌的已用额度：把它的历史行改归到一个归档 id 下（统计里还能看到，只是不算额度了） */
export async function resetTokenUsage(tokenId: string) {
  const archived = clip(`${tokenId}~${Date.now().toString(36)}`, 64);
  if (storageKind() === "mysql") {
    await q(`UPDATE ${T.usage} SET token = ? WHERE token = ?`, [archived, tokenId]);
  } else {
    const all = await kv().hgetall<UsageRow>(LOCAL_KEY);
    for (const [f, r] of Object.entries(all)) {
      if (r.token !== tokenId) continue;
      await kv().hdel(LOCAL_KEY, f);
      const nf = [r.day, r.model, r.channel, archived].join("\t");
      await kv().hset(LOCAL_KEY, nf, { ...r, token: archived });
    }
  }
  tokenCache.delete(tokenId);
}
