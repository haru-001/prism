import "server-only";
import fs from "node:fs";
import mysql from "mysql2/promise";
import type { Pool, PoolOptions, RowDataPacket } from "mysql2/promise";
import { attachDatabasePool } from "@vercel/functions";
import { env } from "./env";

/**
 * MySQL 连接（面向 Aiven for MySQL 免费套餐）。
 *
 * - 连接串用 Aiven 控制台里的 Service URI：mysql://avnadmin:密码@主机:端口/defaultdb?ssl-mode=REQUIRED
 * - CA 证书放在 DATABASE_CA_CERT（整段 PEM，或它的 base64），用来校验服务器证书
 * - 每个函数实例只建一个小连接池，挂在 globalThis 上跨请求复用；
 *   用 @vercel/functions 的 attachDatabasePool 让实例在挂起前先把空闲连接关掉，避免连接泄漏
 * - 免费套餐 max_connections 只有 76，所以池子默认只开 3 条
 */

export const T = {
  kv: "prism_kv",
  hash: "prism_hash",
  list: "prism_list",
  files: "prism_files",
} as const;

// 改表结构时同步修改 scripts/migrate-to-mysql.mjs 里的同名 SQL
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ${T.kv} (
    k VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    v LONGTEXT NOT NULL,
    exp BIGINT NULL,
    PRIMARY KEY (k),
    KEY idx_exp (exp)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS ${T.hash} (
    k VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    f VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    v LONGTEXT NOT NULL,
    PRIMARY KEY (k, f)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS ${T.list} (
    id BIGINT NOT NULL AUTO_INCREMENT,
    k VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    v LONGTEXT NOT NULL,
    PRIMARY KEY (id),
    KEY idx_k_id (k, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS ${T.files} (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    mime VARCHAR(64) NOT NULL,
    size INT NOT NULL,
    data MEDIUMBLOB NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (id),
    KEY idx_created (created_at)
  ) ENGINE=InnoDB`,
];

/** 读 CA 证书：支持整段 PEM、把换行写成 \n 的 PEM、PEM 的 base64，或本地文件路径 DATABASE_CA_FILE */
export function readCa(): string | undefined {
  let v = env.databaseCa.trim();
  if (!v && env.databaseCaFile) {
    try {
      v = fs.readFileSync(env.databaseCaFile, "utf8");
    } catch {
      console.error("[prism] 读不到 DATABASE_CA_FILE：" + env.databaseCaFile);
    }
  }
  if (!v) return undefined;
  if (!v.includes("-----BEGIN")) {
    try {
      const d = Buffer.from(v, "base64").toString("utf8");
      if (d.includes("-----BEGIN")) v = d;
    } catch {}
  }
  v = v.replace(/\\n/g, "\n");
  // 粘贴时换行变成了空格也没关系：把每张证书重新整理成标准 PEM（支持多张证书，Aiven 轮换 CA 时会给一组）
  const blocks = [...v.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)];
  if (!blocks.length) return v;
  return blocks
    .map((m) => {
      const body = m[1].replace(/\s+/g, "");
      return `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)?.join("\n")}\n-----END CERTIFICATE-----\n`;
    })
    .join("");
}

export function sslMode(): "verify" | "insecure" | "off" {
  const u = safeUrl(env.databaseUrl);
  if (!u) return "off";
  const mode = (u.searchParams.get("ssl-mode") || u.searchParams.get("sslmode") || "").toUpperCase();
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  if (mode === "DISABLED" || mode === "DISABLE" || (local && !mode && !readCa())) return "off";
  return readCa() ? "verify" : "insecure";
}

function safeUrl(s: string): URL | null {
  try {
    return s ? new URL(s) : null;
  } catch {
    return null;
  }
}

export function poolOptions(): PoolOptions {
  const u = safeUrl(env.databaseUrl);
  if (!u) throw new Error("DATABASE_URL 不是合法的连接串，应该长这样：mysql://avnadmin:密码@主机:端口/defaultdb?ssl-mode=REQUIRED");
  const mode = sslMode();
  const ca = readCa();
  if (mode === "insecure") console.warn("[prism] 没有设置 DATABASE_CA_CERT：数据库连接仍然加密，但不校验服务器证书。建议把 Aiven 的 CA 证书填进去。");
  return {
    host: u.hostname.replace(/^\[|\]$/g, ""),
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "defaultdb",
    ssl: mode === "off" ? undefined : mode === "verify" ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
    charset: "utf8mb4",
    connectionLimit: env.dbPoolSize,
    maxIdle: 1,
    idleTimeout: 10_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    connectTimeout: 10_000,
    waitForConnections: true,
    queueLimit: 0,
    supportBigNumbers: true,
    bigNumberStrings: false,
  };
}

const g = globalThis as unknown as { __prismPool?: Pool; __prismSchema?: Promise<void> };

export function pool(): Pool {
  if (!g.__prismPool) {
    const p = mysql.createPool(poolOptions());
    g.__prismPool = p;
    // 让 Vercel 在实例挂起前等空闲连接关掉（只在 Vercel 上生效）
    const raw = (p as unknown as { pool: { on: (ev: "release", l: (...a: unknown[]) => void) => void } }).pool;
    try {
      attachDatabasePool({ on: (ev: "release", l: (...a: unknown[]) => void) => raw.on(ev, l), config: { idleTimeout: 10_000 } });
    } catch (e) {
      console.warn("[prism] attachDatabasePool 失败", e);
    }
  }
  return g.__prismPool;
}

const RETRYABLE = new Set(["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNREFUSED", "PROTOCOL_SEQUENCE_TIMEOUT", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]);

function friendly(e: unknown): Error {
  const err = e as { code?: string; message?: string };
  const code = err?.code || "";
  if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN"].includes(code))
    return new Error(`连不上 MySQL 数据库（${code}）。如果用的是 Aiven 免费套餐，去 Aiven 控制台看看服务是不是因为太久没用被关机了，点 Power on 就好。`);
  if (code === "ER_ACCESS_DENIED_ERROR") return new Error("MySQL 用户名或密码不对，检查一下 DATABASE_URL。");
  if (code === "HANDSHAKE_SSL_ERROR" || /certificate|self.signed|SSL/i.test(err?.message || ""))
    return new Error("MySQL 的 SSL 证书校验没通过：检查 DATABASE_CA_CERT 是不是从 Aiven 控制台复制的完整 CA 证书。原始错误：" + err?.message);
  return e instanceof Error ? e : new Error(String(e));
}

async function ensureSchema() {
  if (!g.__prismSchema) {
    g.__prismSchema = (async () => {
      const p = pool();
      for (const sql of SCHEMA) await p.query(sql);
    })().catch((e) => {
      g.__prismSchema = undefined;
      throw e;
    });
  }
  return g.__prismSchema;
}

/** 执行 SQL：首次自动建表；连接被服务端断开（实例被挂起后很常见）时自动重试一次 */
export async function q<R = RowDataPacket[]>(sql: string, params: unknown[] = []): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    try {
      await ensureSchema();
      const [rows] = await pool().query(sql, params);
      return rows as R;
    } catch (e) {
      const code = (e as { code?: string })?.code || "";
      if (attempt === 0 && RETRYABLE.has(code)) continue;
      throw friendly(e);
    }
  }
}

/** 在同一条连接上执行一组语句（事务） */
export async function tx<R>(fn: (run: <X = RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<X>) => Promise<R>): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    let conn: Awaited<ReturnType<Pool["getConnection"]>> | null = null;
    try {
      await ensureSchema();
      conn = await pool().getConnection();
      await conn.beginTransaction();
      const c = conn;
      const out = await fn(async <X,>(sql: string, params: unknown[] = []) => (await c.query(sql, params))[0] as X);
      await conn.commit();
      conn.release();
      return out;
    } catch (e) {
      const code = (e as { code?: string })?.code || "";
      if (conn) {
        try {
          await conn.rollback();
        } catch {}
        if (RETRYABLE.has(code) && !code.startsWith("ER_LOCK")) conn.destroy();
        else conn.release();
      }
      if (attempt === 0 && RETRYABLE.has(code)) continue;
      throw friendly(e);
    }
  }
}
