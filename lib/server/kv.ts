import "server-only";
import { Redis } from "@upstash/redis";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";

/**
 * 极简 KV 抽象：线上用 Upstash Redis，本地没配 Redis 时落到 .data/kv.json，方便开发和测试。
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

class UpstashKV implements KV {
  r: Redis;
  constructor() {
    this.r = new Redis({ url: env.redisUrl, token: env.redisToken });
  }
  async get<T>(key: string) {
    return ((await this.r.get<T>(key)) ?? null) as T | null;
  }
  async set(key: string, value: unknown, opts?: { ex?: number }) {
    if (opts?.ex) await this.r.set(key, value, { ex: opts.ex });
    else await this.r.set(key, value);
  }
  async del(key: string) {
    await this.r.del(key);
  }
  async incr(key: string, exSeconds?: number) {
    const n = await this.r.incr(key);
    if (exSeconds && n === 1) await this.r.expire(key, exSeconds);
    return n;
  }
  async lpush(key: string, value: unknown, maxLen: number) {
    const p = this.r.pipeline();
    p.lpush(key, JSON.stringify(value));
    p.ltrim(key, 0, maxLen - 1);
    await p.exec();
  }
  async lrange<T>(key: string, start: number, stop: number) {
    const arr = await this.r.lrange(key, start, stop);
    return arr.map((x) => (typeof x === "string" ? JSON.parse(x) : x)) as T[];
  }
  async hset(key: string, field: string, value: unknown) {
    await this.r.hset(key, { [field]: JSON.stringify(value) });
  }
  async hget<T>(key: string, field: string) {
    const v = await this.r.hget(key, field);
    if (v == null) return null;
    return (typeof v === "string" ? JSON.parse(v) : v) as T;
  }
  async hdel(key: string, field: string) {
    await this.r.hdel(key, field);
  }
  async hgetall<T>(key: string) {
    const all = (await this.r.hgetall(key)) || {};
    const out: Record<string, T> = {};
    for (const [k, v] of Object.entries(all)) out[k] = (typeof v === "string" ? JSON.parse(v) : v) as T;
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
  if (!g.__prismKV) g.__prismKV = env.redisUrl && env.redisToken ? new UpstashKV() : new LocalKV();
  return g.__prismKV;
}

export function storageKind(): "redis" | "local" {
  return env.redisUrl && env.redisToken ? "redis" : "local";
}
