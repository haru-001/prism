import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import { q, tx, T } from "./mysql";

/**
 * 极简 KV 抽象（接口沿用最初的 Redis 风格）：线上用 MySQL（Aiven for MySQL），
 * 本地没配 DATABASE_URL 时落到 .data/kv.json，方便开发和测试。
 */
export interface KV {
  /** fresh: 跳过内存缓存直接读库（读-改-写时用，避免拿旧数据覆盖别的实例刚写的内容） */
  get<T>(key: string, opts?: { fresh?: boolean }): Promise<T | null>;
  /** 一次往返读多个普通键 */
  mget(keys: string[], opts?: { fresh?: boolean }): Promise<Record<string, unknown>>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string, exSeconds?: number): Promise<number>;
  lpush(key: string, value: unknown, maxLen: number): Promise<void>;
  lrange<T>(key: string, start: number, stop: number): Promise<T[]>;
  hset(key: string, field: string, value: unknown): Promise<void>;
  hget<T>(key: string, field: string): Promise<T | null>;
  hdel(key: string, field: string): Promise<void>;
  hgetall<T>(key: string): Promise<Record<string, T>>;
}

export const P = "prism:";

const J = (v: unknown) => (v === undefined ? "null" : JSON.stringify(v));
const parse = <T,>(s: string): T => JSON.parse(s) as T;

/** Aiven for MySQL（或任何 MySQL 8）：三张表分别存普通键、哈希和列表 */
class MysqlKV implements KV {
  private sweep() {
    // 偶尔顺手清掉过期的键（只有登录失败计数这类键会过期）
    if (Math.random() < 0.02) q(`DELETE FROM ${T.kv} WHERE exp IS NOT NULL AND exp < ?`, [Date.now()]).catch(() => {});
  }
  async get<T>(key: string) {
    const rows = await q<RowDataPacket[]>(`SELECT v, exp FROM ${T.kv} WHERE k = ?`, [key]);
    const r = rows[0];
    if (!r) return null;
    if (r.exp != null && Number(r.exp) < Date.now()) {
      await q(`DELETE FROM ${T.kv} WHERE k = ? AND exp < ?`, [key, Date.now()]);
      return null;
    }
    return parse<T>(r.v);
  }
  async mget(keys: string[]) {
    const out: Record<string, unknown> = {};
    if (!keys.length) return out;
    const rows = await q<RowDataPacket[]>(`SELECT k, v, exp FROM ${T.kv} WHERE k IN (?)`, [keys]);
    const now = Date.now();
    for (const k of keys) out[k] = null;
    for (const r of rows) if (r.exp == null || Number(r.exp) >= now) out[r.k] = parse(r.v);
    return out;
  }
  async set(key: string, value: unknown, opts?: { ex?: number }) {
    const exp = opts?.ex ? Date.now() + opts.ex * 1000 : null;
    await q(`INSERT INTO ${T.kv} (k, v, exp) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v), exp = VALUES(exp)`, [key, J(value), exp]);
    if (exp) this.sweep();
  }
  async del(key: string) {
    // 一个键只会在其中一张表里；三条删除并行发出，只等一个往返（原来是事务里串行 5 次往返）
    await Promise.all([
      q(`DELETE FROM ${T.kv} WHERE k = ?`, [key]),
      q(`DELETE FROM ${T.hash} WHERE k = ?`, [key]),
      q(`DELETE FROM ${T.list} WHERE k = ?`, [key]),
    ]);
  }
  async incr(key: string, exSeconds?: number) {
    const now = Date.now();
    const exp = exSeconds ? now + exSeconds * 1000 : null;
    return tx(async (run) => {
      // 已过期的键按新键处理：从 1 开始，重新计时
      await run(
        `INSERT INTO ${T.kv} (k, v, exp) VALUES (?, '1', ?) ON DUPLICATE KEY UPDATE
           v = IF(exp IS NOT NULL AND exp < ?, '1', CAST(CAST(v AS SIGNED) + 1 AS CHAR)),
           exp = IF(exp IS NOT NULL AND exp < ?, VALUES(exp), exp)`,
        [key, exp, now, now],
      );
      const rows = await run<RowDataPacket[]>(`SELECT v FROM ${T.kv} WHERE k = ?`, [key]);
      return Number(rows[0]?.v || 0);
    });
  }
  async lpush(key: string, value: unknown, maxLen: number) {
    await q(`INSERT INTO ${T.list} (k, v) VALUES (?, ?)`, [key, J(value)]);
    // 不放进事务：每条语句都能看到别的请求刚写进去的行，并发写入时也能准确裁到 maxLen 条。
    // 裁剪合成一条语句（原来是先查第 maxLen 条的 id 再删，两次往返）
    await q(
      `DELETE FROM ${T.list} WHERE k = ? AND id < (SELECT id FROM (SELECT id FROM ${T.list} WHERE k = ? ORDER BY id DESC LIMIT 1 OFFSET ?) AS cut)`,
      [key, key, maxLen - 1],
    );
  }
  async lrange<T>(key: string, start: number, stop: number) {
    const limit = stop < 0 ? 1_000_000 : Math.max(0, stop - start + 1);
    const rows = await q<RowDataPacket[]>(`SELECT v FROM ${T.list} WHERE k = ? ORDER BY id DESC LIMIT ? OFFSET ?`, [key, limit, start]);
    return rows.map((r) => parse<T>(r.v));
  }
  async hset(key: string, field: string, value: unknown) {
    await q(`INSERT INTO ${T.hash} (k, f, v) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)`, [key, field, J(value)]);
  }
  async hget<T>(key: string, field: string) {
    const rows = await q<RowDataPacket[]>(`SELECT v FROM ${T.hash} WHERE k = ? AND f = ?`, [key, field]);
    return rows[0] ? parse<T>(rows[0].v) : null;
  }
  async hdel(key: string, field: string) {
    await q(`DELETE FROM ${T.hash} WHERE k = ? AND f = ?`, [key, field]);
  }
  async hgetall<T>(key: string) {
    const rows = await q<RowDataPacket[]>(`SELECT f, v FROM ${T.hash} WHERE k = ?`, [key]);
    const out: Record<string, T> = {};
    for (const r of rows) out[r.f] = parse<T>(r.v);
    return out;
  }
}

type Entry = { v: unknown; exp?: number };

class LocalKV implements KV {
  file = path.join(process.cwd(), ".data", "kv.json");
  data: Record<string, Entry> = {};
  loaded = false;
  load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      this.data = {};
    }
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }
  raw(key: string): unknown {
    this.load();
    const e = this.data[key];
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) {
      delete this.data[key];
      return null;
    }
    return e.v;
  }
  put(key: string, v: unknown, exSeconds?: number) {
    this.load();
    this.data[key] = { v, exp: exSeconds ? Date.now() + exSeconds * 1000 : this.data[key]?.exp };
    this.save();
  }
  async get<T>(key: string) {
    const v = this.raw(key);
    return v == null ? null : (structuredClone(v) as T);
  }
  async mget(keys: string[]) {
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = await this.get(k);
    return out;
  }
  async set(key: string, value: unknown, opts?: { ex?: number }) {
    this.load();
    this.data[key] = { v: structuredClone(value), exp: opts?.ex ? Date.now() + opts.ex * 1000 : undefined };
    this.save();
  }
  async del(key: string) {
    this.load();
    delete this.data[key];
    this.save();
  }
  async incr(key: string, exSeconds?: number) {
    const n = Number(this.raw(key) || 0) + 1;
    this.put(key, n, n === 1 ? exSeconds : undefined);
    return n;
  }
  async lpush(key: string, value: unknown, maxLen: number) {
    const arr = ((this.raw(key) as unknown[]) || []).slice();
    arr.unshift(structuredClone(value));
    this.put(key, arr.slice(0, maxLen));
  }
  async lrange<T>(key: string, start: number, stop: number) {
    const arr = (this.raw(key) as T[]) || [];
    return structuredClone(arr.slice(start, stop < 0 ? undefined : stop + 1));
  }
  async hset(key: string, field: string, value: unknown) {
    const h = { ...((this.raw(key) as Record<string, unknown>) || {}) };
    h[field] = structuredClone(value);
    this.put(key, h);
  }
  async hget<T>(key: string, field: string) {
    const h = (this.raw(key) as Record<string, unknown>) || {};
    return h[field] == null ? null : (structuredClone(h[field]) as T);
  }
  async hdel(key: string, field: string) {
    const h = { ...((this.raw(key) as Record<string, unknown>) || {}) };
    delete h[field];
    this.put(key, h);
  }
  async hgetall<T>(key: string) {
    return structuredClone((this.raw(key) as Record<string, T>) || {});
  }
}

/**
 * 很少变、但几乎每个请求都要读的配置（密码哈希、渠道、设置、引导进度、访问令牌、图库隐藏列表）
 * 在实例内存里缓存一小段时间：
 * - 任何一个缺了，就用一条 SQL 把这几个键一起读回来（冷启动时只多一次往返）
 * - 本实例写入时同步更新缓存，所以「改了就生效」
 * - 别的实例最多晚 PRISM_CACHE_TTL 秒看到变化；关键路径（登录态、令牌、找不到模型）发现对不上时会再直接读库确认
 */
export const HOT_KEYS = [P + "auth:pw", P + "channels", P + "settings", P + "onboarding", P + "token", P + "tokens", P + "pricing", P + "presets", P + "gallery:hidden", P + "dbsize"];
const HOT = new Set(HOT_KEYS);

class CachedKV implements KV {
  private mem = new Map<string, { v: unknown; at: number }>();
  private loading: Promise<void> | null = null;
  constructor(
    private inner: KV,
    private ttlMs: number,
  ) {}
  private fresh(k: string) {
    const e = this.mem.get(k);
    return !!e && Date.now() - e.at < this.ttlMs;
  }
  private prime(k: string, v: unknown) {
    if (HOT.has(k) && this.ttlMs > 0) this.mem.set(k, { v: v === undefined ? null : structuredClone(v), at: Date.now() });
  }
  private out<T>(k: string): T | null {
    const v = this.mem.get(k)?.v;
    return v == null ? null : (structuredClone(v) as T);
  }
  /** 把所有过期/缺失的热键一次读回来；并发请求共用同一次读取 */
  private async fill(force: string[] = []) {
    if (this.loading && !force.length) return this.loading;
    const need = HOT_KEYS.filter((k) => force.includes(k) || !this.fresh(k));
    if (!need.length) return;
    const p = this.inner.mget(need).then((vals) => {
      for (const k of need) this.prime(k, vals[k]);
    });
    if (!force.length) {
      this.loading = p.finally(() => {
        this.loading = null;
      });
      return this.loading;
    }
    return p;
  }
  async get<T>(key: string, opts?: { fresh?: boolean }) {
    if (!HOT.has(key) || this.ttlMs <= 0) return this.inner.get<T>(key);
    if (opts?.fresh) {
      const v = await this.inner.get<T>(key);
      this.prime(key, v);
      return v;
    }
    if (!this.fresh(key)) await this.fill();
    if (!this.fresh(key)) await this.fill([key]);
    return this.out<T>(key);
  }
  async mget(keys: string[], opts?: { fresh?: boolean }) {
    const out: Record<string, unknown> = {};
    const cold = keys.filter((k) => !HOT.has(k) || this.ttlMs <= 0 || opts?.fresh);
    const hot = keys.filter((k) => !cold.includes(k));
    // 读热键时顺带把其它热键一起读回来
    const [, coldVals] = await Promise.all([
      hot.some((k) => !this.fresh(k)) ? this.fill() : null,
      cold.length ? this.inner.mget(cold) : ({} as Record<string, unknown>),
    ]);
    for (const k of cold) {
      out[k] = coldVals[k] ?? null;
      this.prime(k, out[k]);
    }
    for (const k of hot) out[k] = this.out(k);
    return out;
  }
  async set(key: string, value: unknown, opts?: { ex?: number }) {
    await this.inner.set(key, value, opts);
    if (!opts?.ex) this.prime(key, value);
  }
  async del(key: string) {
    await this.inner.del(key);
    this.prime(key, null);
  }
  incr(key: string, exSeconds?: number) {
    return this.inner.incr(key, exSeconds);
  }
  lpush(key: string, value: unknown, maxLen: number) {
    return this.inner.lpush(key, value, maxLen);
  }
  lrange<T>(key: string, start: number, stop: number) {
    return this.inner.lrange<T>(key, start, stop);
  }
  hset(key: string, field: string, value: unknown) {
    return this.inner.hset(key, field, value);
  }
  hget<T>(key: string, field: string) {
    return this.inner.hget<T>(key, field);
  }
  hdel(key: string, field: string) {
    return this.inner.hdel(key, field);
  }
  hgetall<T>(key: string) {
    return this.inner.hgetall<T>(key);
  }
}

const g = globalThis as unknown as { __prismKV?: KV };

export function kv(): KV {
  if (!g.__prismKV) g.__prismKV = env.databaseUrl ? new CachedKV(new MysqlKV(), env.cacheTtlMs) : new LocalKV();
  return g.__prismKV;
}

export function storageKind(): "mysql" | "local" {
  return env.databaseUrl ? "mysql" : "local";
}
