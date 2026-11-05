import "server-only";
import fs from "node:fs";
import mysql from "mysql2/promise";
import type { Pool, PoolConnection, PoolOptions, RowDataPacket } from "mysql2/promise";
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
  usage: "prism_usage",
  logd: "prism_logd",
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
  // 用量统计：按「天 × 模型 × 渠道 × 令牌」聚合，一年也就几千行，1GB 免费档完全放得下
  `CREATE TABLE IF NOT EXISTS ${T.usage} (
    day CHAR(10) CHARACTER SET ascii NOT NULL,
    model VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    channel VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    token VARCHAR(64) CHARACTER SET ascii NOT NULL,
    requests INT NOT NULL DEFAULT 0,
    fails INT NOT NULL DEFAULT 0,
    in_tok BIGINT NOT NULL DEFAULT 0,
    out_tok BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, model, channel, token),
    KEY idx_token (token)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  // 日志详情：和日志一样只留最近 500 条，单条已截断控制在几十 KB 内
  `CREATE TABLE IF NOT EXISTS ${T.logd} (
    seq BIGINT NOT NULL AUTO_INCREMENT,
    id VARCHAR(40) CHARACTER SET ascii NOT NULL,
    v MEDIUMTEXT NOT NULL,
    PRIMARY KEY (seq),
    UNIQUE KEY uk_id (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
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
    // 空闲连接全部留着复用（10 秒没人用再关）。以前 maxIdle=1 会让并发查询后多出来的连接一秒内就被关掉，
    // 下一次并发又要重新做 TCP + SSL 握手，跨区域时每次握手要好几个往返
    maxIdle: env.dbPoolSize,
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

const g = globalThis as unknown as { __prismPool?: Pool; __prismSchema?: Promise<void>; __prismDbDown?: { until: number; err: DbDownError } };

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

// 连接被拒绝（ECONNREFUSED）说明数据库确实没开，不再重试，免得多等
// 只重试「连接用着用着断了」这类情况。ETIMEDOUT 多半是根本连不上（Aiven 关机），再等 10 秒也没用，不重试
const RETRYABLE = new Set(["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "EPIPE", "PROTOCOL_SEQUENCE_TIMEOUT", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]);

/**
 * 数据库不可用（Aiven 免费档被关机、网络不通、连接数满、账号或证书配置不对）。
 * digest 让 Next.js 在生产环境把错误类型带给前端的 error.tsx，好显示「数据库睡着了」而不是白屏。
 */
export type DbDownKind = "down" | "busy" | "config";
export class DbDownError extends Error {
  readonly kind: DbDownKind;
  readonly code: string;
  readonly digest: string;
  constructor(kind: DbDownKind, code: string, message: string) {
    super(message);
    this.name = "DbDownError";
    this.kind = kind;
    this.code = code;
    this.digest = "PRISM_DB_" + kind.toUpperCase();
  }
}

export function isDbDown(e: unknown): e is DbDownError {
  return e instanceof DbDownError || (e as { name?: string })?.name === "DbDownError";
}

const DOWN_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "PROTOCOL_CONNECTION_LOST", "ECONNRESET", "EPIPE", "PROTOCOL_SEQUENCE_TIMEOUT", "ER_SERVER_SHUTDOWN"]);

function friendly(e: unknown): Error {
  if (isDbDown(e)) return e;
  const err = e as { code?: string; message?: string };
  const code = err?.code || "";
  if (DOWN_CODES.has(code))
    return new DbDownError("down", code, `连不上 MySQL 数据库（${code}）。如果用的是 Aiven 免费套餐，去 Aiven 控制台看看服务是不是因为太久没用被关机了，点 Power on 就好。`);
  if (code === "ER_CON_COUNT_ERROR" || code === "ER_TOO_MANY_USER_CONNECTIONS")
    return new DbDownError("busy", code, `MySQL 的连接数满了（${code}），稍等一会儿再试。`);
  if (code === "ER_ACCESS_DENIED_ERROR" || code === "ER_DBACCESS_DENIED_ERROR" || code === "ER_BAD_DB_ERROR")
    return new DbDownError("config", code, "MySQL 用户名、密码或库名不对，检查一下 DATABASE_URL。");
  if (code === "HANDSHAKE_SSL_ERROR" || /certificate|self.signed|SSL/i.test(err?.message || ""))
    return new DbDownError("config", code || "SSL", "MySQL 的 SSL 证书校验没通过：检查 DATABASE_CA_CERT 是不是从 Aiven 控制台复制的完整 CA 证书。原始错误：" + err?.message);
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * 熔断：发现数据库连不上后 15 秒内不再去连（每次连接最多要等 10 秒超时），直接报「数据库睡着了」，页面秒出提示。
 * 「重试」按钮走 pingDb()，不受熔断限制。
 */
const BREAK_MS = 15_000;
function tripped(): DbDownError | null {
  const d = g.__prismDbDown;
  return d && d.until > Date.now() ? d.err : null;
}
function noteResult(e?: unknown) {
  if (e === undefined) {
    g.__prismDbDown = undefined;
    return;
  }
  if (isDbDown(e) && e.kind !== "busy") g.__prismDbDown = { until: Date.now() + BREAK_MS, err: e };
}

/** 真正连一次数据库（不受熔断限制），给「重试」按钮和状态检查用 */
export async function pingDb(): Promise<{ ok: true; ms: number } | { ok: false; error: DbDownError | Error }> {
  const t = Date.now();
  try {
    await pool().query("SELECT 1");
    noteResult();
    return { ok: true, ms: Date.now() - t };
  } catch (e) {
    const err = friendly(e);
    noteResult(err);
    return { ok: false, error: err };
  }
}

/** 建表。不再每个实例启动都先跑一遍：平时直接查，只有查询报「表不存在」时才建表并重试 */
export async function ensureSchema(force = false) {
  if (force) g.__prismSchema = undefined;
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

const noTable = (e: unknown) => {
  const err = e as { code?: string; errno?: number };
  return err?.code === "ER_NO_SUCH_TABLE" || err?.errno === 1146;
};

/** 执行 SQL：表不存在时自动建表；连接被服务端断开（实例被挂起后很常见）时自动重试一次 */
export async function q<R = RowDataPacket[]>(sql: string, params: unknown[] = []): Promise<R> {
  const down = tripped();
  if (down) throw down;
  try {
    return await qRaw<R>(sql, params);
  } catch (e) {
    noteResult(e);
    throw e;
  }
}

async function qRaw<R>(sql: string, params: unknown[]): Promise<R> {
  let built = false;
  for (let attempt = 0; ; attempt++) {
    try {
      const [rows] = await pool().query(sql, params);
      if (g.__prismDbDown) noteResult();
      return rows as R;
    } catch (e) {
      if (!built && noTable(e)) {
        built = true;
        await ensureSchema(true).catch((x) => {
          throw friendly(x);
        });
        attempt--;
        continue;
      }
      const code = (e as { code?: string })?.code || "";
      if (attempt === 0 && RETRYABLE.has(code)) continue;
      throw friendly(e);
    }
  }
}

/** 在同一条连接上执行一组语句（事务） */
export async function tx<R>(fn: (run: <X = RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<X>) => Promise<R>): Promise<R> {
  const down = tripped();
  if (down) throw down;
  try {
    return await txRaw(fn);
  } catch (e) {
    noteResult(e);
    throw e;
  }
}

async function txRaw<R>(fn: (run: <X = RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<X>) => Promise<R>): Promise<R> {
  let built = false;
  for (let attempt = 0; ; attempt++) {
    let conn: Awaited<ReturnType<Pool["getConnection"]>> | null = null;
    try {
      conn = await pool().getConnection();
      await conn.beginTransaction();
      const c = conn;
      const out = await fn(async <X>(sql: string, params: unknown[] = []) => (await c.query(sql, params))[0] as X);
      await conn.commit();
      conn.release();
      return out;
    } catch (e) {
      const code = (e as { code?: string })?.code || "";
      if (conn) {
        try {
          await conn.rollback();
        } catch {}
        if ((RETRYABLE.has(code) || code === "ETIMEDOUT") && !code.startsWith("ER_LOCK")) conn.destroy();
        else conn.release();
      }
      if (!built && noTable(e)) {
        built = true;
        await ensureSchema(true).catch((x) => {
          throw friendly(x);
        });
        attempt--;
        continue;
      }
      if (attempt === 0 && RETRYABLE.has(code)) continue;
      throw friendly(e);
    }
  }
}

/** 用同一条连接跑几条语句（需要先设会话变量时用），同样受熔断保护、报错转成中文 */
export async function withConn<R>(fn: (run: <X = RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<X>) => Promise<R>): Promise<R> {
  const down = tripped();
  if (down) throw down;
  let conn: PoolConnection | null = null;
  try {
    conn = await pool().getConnection();
    const c = conn;
    const out = await fn(async <X>(sql: string, params: unknown[] = []) => (await c.query(sql, params))[0] as X);
    noteResult();
    return out;
  } catch (e) {
    const err = friendly(e);
    noteResult(err);
    throw err;
  } finally {
    conn?.release();
  }
}
