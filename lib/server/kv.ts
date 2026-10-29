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
  get<T>(key: string): Promise<T | null>;
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
  async set(key: string, value: unknown, opts?: { ex?: number }) {
    const exp = opts?.ex ? Date.now() + opts.ex * 1000 : null;
    await q(`INSERT INTO ${T.kv} (k, v, exp) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v), exp = VALUES(exp)`, [key, J(value), exp]);
    if (exp) this.sweep();
  }
  async del(key: string) {
    await tx(async (run) => {
      await run(`DELETE FROM ${T.kv} WHERE k = ?`, [key]);
      await run(`DELETE FROM ${T.hash} WHERE k = ?`, [key]);
      await run(`DELETE FROM ${T.list} WHERE k = ?`, [key]);
    });
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
    // 不放进事务：每条语句都能看到别的请求刚写进去的行，并发写入时也能准确裁到 maxLen 条
    const rows = await q<RowDataPacket[]>(`SELECT id FROM ${T.list} WHERE k = ? ORDER BY id DESC LIMIT 1 OFFSET ?`, [key, maxLen - 1]);
    if (rows[0]) await q(`DELETE FROM ${T.list} WHERE k = ? AND id < ?`, [key, rows[0].id]);
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

const g = globalThis as unknown as { __prismKV?: KV };

export function kv(): KV {
  if (!g.__prismKV) g.__prismKV = env.databaseUrl ? new MysqlKV() : new LocalKV();
  return g.__prismKV;
}

export function storageKind(): "mysql" | "local" {
  return env.databaseUrl ? "mysql" : "local";
}
