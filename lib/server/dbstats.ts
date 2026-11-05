import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { kv, P, storageKind } from "./kv";
import { q, T, withConn } from "./mysql";
import { waitUntil } from "@vercel/functions";
import { dayOf } from "./stats";
import { forgetFiles } from "./files";

/**
 * 数据库容量看板和清理。
 * 只在需要时查：打开设置页的「数据库容量」、或者快照超过 6 小时后在某次打开页面的响应发出后量一次。
 * 量总量只查 information_schema（不扫表）；按类型拆分时才统计各类数据的长度。
 */

export type DbCategory = "images" | "conversations" | "logs" | "usage" | "other";
export const CATEGORY_NAMES: Record<DbCategory, string> = {
  images: "图片",
  conversations: "会话",
  logs: "请求日志",
  usage: "用量统计",
  other: "其他（设置、渠道、令牌等）",
};

export interface DbSnapshot {
  usedBytes: number;
  quotaBytes: number;
  at: number;
}

export interface DbUsage extends DbSnapshot {
  storage: "mysql" | "local";
  ratio: number;
  warnRatio: number;
  freeBytes: number;
  tables: { name: string; bytes: number; free: number; rows: number }[];
  categories: { key: DbCategory; name: string; bytes: number; count: number; oldest: number | null }[];
}

const SNAP_KEY = P + "dbsize";
const SNAP_MAX_AGE = 6 * 3600_000;

export function quotaBytes() {
  return Math.max(1, Number(process.env.DB_QUOTA_MB) || 1024) * 1024 * 1024;
}
export function warnRatio() {
  const p = Number(process.env.DB_WARN_PERCENT);
  return p > 0 && p < 100 ? p / 100 : 0.8;
}

/** Prism 所在库里各张表的大小。MySQL 8 默认把这些数字缓存一天，这里先在本连接上关掉缓存再查 */
async function measureTables() {
  const rows = await withConn(async (run) => {
    try {
      await run("SET SESSION information_schema_stats_expiry = 0");
    } catch {}
    const r = await run<RowDataPacket[]>(
      `SELECT TABLE_NAME AS name, COALESCE(DATA_LENGTH,0) AS d, COALESCE(INDEX_LENGTH,0) AS i, COALESCE(DATA_FREE,0) AS f, COALESCE(TABLE_ROWS,0) AS r
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`,
    );
    try {
      await run("SET SESSION information_schema_stats_expiry = DEFAULT");
    } catch {}
    return r;
  });
  return rows.map((r) => ({ name: String(r.name), bytes: Number(r.d) + Number(r.i), free: Number(r.f), rows: Number(r.r) }));
}

function total(tables: { bytes: number; free: number }[]) {
  return tables.reduce((s, t) => s + t.bytes + t.free, 0);
}

/** 量一次总量并存成快照（快照是热键，页面启动时顺便读到，不额外查库） */
export async function refreshDbSnapshot(): Promise<DbSnapshot | null> {
  if (storageKind() !== "mysql") return null;
  const snap: DbSnapshot = { usedBytes: total(await measureTables()), quotaBytes: quotaBytes(), at: Date.now() };
  await kv().set(SNAP_KEY, snap);
  return snap;
}

export async function getDbSnapshot(): Promise<DbSnapshot | null> {
  if (storageKind() !== "mysql") return null;
  return (await kv().get<DbSnapshot>(SNAP_KEY)) || null;
}

const g = globalThis as unknown as { __prismDbSnapTry?: number };
/** 重量容量前先等一会儿：让这次页面和它紧跟着的几个请求先用数据库（量容量要让 MySQL 重新统计每张表，冷启动时可能要一两秒） */
const SNAP_DELAY_MS = 4000;

/**
 * 快照超过 6 小时就在页面发出几秒后重量一次；同一实例 10 分钟内最多试一次，失败也不影响页面。
 * 不放进 defer 的待写队列：读日志等地方会先等那些写入落库，不能被量容量拖慢。
 */
export function refreshDbSnapshotLater(snap: DbSnapshot | null | undefined) {
  if (storageKind() !== "mysql") return;
  if (snap && Date.now() - snap.at < SNAP_MAX_AGE && snap.quotaBytes === quotaBytes()) return;
  if (g.__prismDbSnapTry && Date.now() - g.__prismDbSnapTry < 600_000) return;
  g.__prismDbSnapTry = Date.now();
  const p = new Promise((r) => setTimeout(r, SNAP_DELAY_MS))
    .then(() => refreshDbSnapshot())
    .catch((e) => console.error("[prism] 数据库容量统计失败", e));
  try {
    waitUntil(p);
  } catch {}
}

/** 共用表里每种数据各自的长度，用来把整张表的空间按比例分给各类 */
async function sharedLengths() {
  const [kvRows, hashRows, listRows] = await Promise.all([
    q<RowDataPacket[]>(
      `SELECT CASE WHEN k LIKE ? THEN 'conversations' ELSE 'other' END AS c, SUM(LENGTH(k) + LENGTH(v)) AS n, COUNT(*) AS cnt FROM ${T.kv} GROUP BY c`,
      [P + "conv:%"],
    ),
    q<RowDataPacket[]>(
      `SELECT CASE WHEN k = ? THEN 'conversations' ELSE 'other' END AS c, SUM(LENGTH(k) + LENGTH(f) + LENGTH(v)) AS n, COUNT(*) AS cnt, MIN(CASE WHEN k = ? THEN CAST(JSON_EXTRACT(v, '$.updatedAt') AS UNSIGNED) END) AS oldest FROM ${T.hash} GROUP BY c`,
      [P + "conv:meta", P + "conv:meta"],
    ),
    q<RowDataPacket[]>(
      `SELECT CASE k WHEN ? THEN 'logs' WHEN ? THEN 'images' ELSE 'other' END AS c, SUM(LENGTH(k) + LENGTH(v)) AS n, COUNT(*) AS cnt, MIN(CAST(JSON_EXTRACT(v, '$.at') AS UNSIGNED)) AS oldest FROM ${T.list} GROUP BY c`,
      [P + "logs", P + "gallery"],
    ),
  ]);
  const pack = (rows: RowDataPacket[]) => rows.map((r) => ({ c: r.c as DbCategory, n: Number(r.n) || 0, cnt: Number(r.cnt) || 0, oldest: r.oldest == null ? null : Number(r.oldest) }));
  return { kv: pack(kvRows), hash: pack(hashRows), list: pack(listRows) };
}

/** 容量看板：总量、每张表、按类型拆分（只在打开设置页时调用） */
export async function dbUsage(): Promise<DbUsage> {
  const quota = quotaBytes();
  const warn = warnRatio();
  if (storageKind() !== "mysql")
    return { storage: "local", usedBytes: 0, quotaBytes: quota, at: Date.now(), ratio: 0, warnRatio: warn, freeBytes: 0, tables: [], categories: [] };

  const [tables, shared, files, usage, convCount] = await Promise.all([
    measureTables(),
    sharedLengths(),
    q<RowDataPacket[]>(`SELECT COUNT(*) AS cnt, MIN(created_at) AS oldest FROM ${T.files}`),
    q<RowDataPacket[]>(`SELECT COUNT(*) AS cnt, MIN(day) AS oldest FROM ${T.usage}`),
    q<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM ${T.hash} WHERE k = ?`, [P + "conv:meta"]),
  ]);
  const cats: Record<DbCategory, { bytes: number; count: number; oldest: number | null }> = {
    images: { bytes: 0, count: Number(files[0]?.cnt) || 0, oldest: files[0]?.oldest == null ? null : Number(files[0].oldest) },
    conversations: { bytes: 0, count: Number(convCount[0]?.cnt) || 0, oldest: null },
    logs: { bytes: 0, count: 0, oldest: null },
    usage: { bytes: 0, count: Number(usage[0]?.cnt) || 0, oldest: usage[0]?.oldest ? Date.parse(String(usage[0].oldest) + "T00:00:00Z") : null },
    other: { bytes: 0, count: 0, oldest: null },
  };
  const add = (c: DbCategory, n: number) => (cats[c].bytes += n);
  const split = (tableBytes: number, parts: { c: DbCategory; n: number }[]) => {
    const sum = parts.reduce((s, p) => s + p.n, 0);
    if (!sum) return add("other", tableBytes);
    for (const p of parts) add(p.c, Math.round((tableBytes * p.n) / sum));
  };
  for (const t of tables) {
    const b = t.bytes + t.free;
    if (t.name === T.files) add("images", b);
    else if (t.name === T.logd) add("logs", b);
    else if (t.name === T.usage) add("usage", b);
    else if (t.name === T.kv) split(b, shared.kv);
    else if (t.name === T.hash) split(b, shared.hash);
    else if (t.name === T.list) split(b, shared.list);
    else add("other", b);
  }
  const logRow = shared.list.find((x) => x.c === "logs");
  cats.logs.count = logRow?.cnt || 0;
  cats.logs.oldest = logRow?.oldest ?? null;
  cats.conversations.oldest = shared.hash.find((x) => x.c === "conversations")?.oldest ?? null;

  const used = total(tables);
  const snap: DbSnapshot = { usedBytes: used, quotaBytes: quota, at: Date.now() };
  await kv().set(SNAP_KEY, snap);
  return {
    storage: "mysql",
    ...snap,
    ratio: used / quota,
    warnRatio: warn,
    freeBytes: tables.reduce((s, t) => s + t.free, 0),
    tables: tables.sort((a, b) => b.bytes + b.free - (a.bytes + a.free)),
    categories: (Object.keys(cats) as DbCategory[]).map((k) => ({ key: k, name: CATEGORY_NAMES[k], ...cats[k] })),
  };
}

// ===================== 清理 =====================

export type CleanupType = "logs" | "usage" | "images" | "conversations";
export const CLEANUP_TYPES: CleanupType[] = ["logs", "usage", "images", "conversations"];

export interface CleanupResult {
  type: CleanupType;
  olderThanDays: number;
  count: number;
  bytes: number;
  applied: boolean;
  freedBytes?: number;
  usage?: DbSnapshot | null;
}

/**
 * 清理旧数据。dryRun=true 只统计会删多少（前端拿来给用户确认），确认后再以 dryRun=false 调用。
 * olderThanDays=0 表示这一类全部清掉。删完对用到的表做一次 OPTIMIZE TABLE，把空间真正还给磁盘。
 */
export async function cleanup(type: CleanupType, olderThanDays: number, dryRun: boolean): Promise<CleanupResult> {
  if (storageKind() !== "mysql") throw new Error("现在用的是本地文件存储，不需要清理数据库");
  const days = Math.max(0, Math.floor(olderThanDays));
  const cutoff = days === 0 ? Date.now() + 1 : Date.now() - days * 86400_000;
  const res: CleanupResult = { type, olderThanDays: days, count: 0, bytes: 0, applied: false };
  let tables: string[] = [];

  if (type === "logs") {
    const ids = await q<RowDataPacket[]>(
      `SELECT id AS rid, JSON_UNQUOTE(JSON_EXTRACT(v, '$.id')) AS lid, LENGTH(v) AS n FROM ${T.list} WHERE k = ? AND CAST(JSON_EXTRACT(v, '$.at') AS UNSIGNED) < ?`,
      [P + "logs", cutoff],
    );
    const logIds = ids.map((r) => String(r.lid)).filter(Boolean);
    let detailBytes = 0;
    if (logIds.length) {
      const d = await q<RowDataPacket[]>(`SELECT COALESCE(SUM(LENGTH(v)), 0) AS n FROM ${T.logd} WHERE id IN (?)`, [logIds]);
      detailBytes = Number(d[0]?.n) || 0;
    }
    res.count = ids.length;
    res.bytes = ids.reduce((s, r) => s + Number(r.n), 0) + detailBytes;
    if (!dryRun && ids.length) {
      for (const part of chunks(ids.map((r) => Number(r.rid)), 500)) await q(`DELETE FROM ${T.list} WHERE id IN (?)`, [part]);
      for (const part of chunks(logIds, 500)) await q(`DELETE FROM ${T.logd} WHERE id IN (?)`, [part]);
      tables = [T.list, T.logd];
    }
  } else if (type === "usage") {
    const day = days === 0 ? "9999-12-31" : dayOf(cutoff);
    const r = await q<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM ${T.usage} WHERE day < ?`, [day]);
    res.count = Number(r[0]?.cnt) || 0;
    res.bytes = res.count * 120; // 每行大约 100 多字节，只用来给用户一个量级
    if (!dryRun && res.count) {
      await q(`DELETE FROM ${T.usage} WHERE day < ?`, [day]);
      tables = [T.usage];
    }
  } else if (type === "images") {
    const r = await q<RowDataPacket[]>(`SELECT id, size FROM ${T.files} WHERE created_at < ?`, [cutoff]);
    res.count = r.length;
    res.bytes = r.reduce((s, x) => s + Number(x.size), 0);
    if (!dryRun && r.length) {
      const ids = r.map((x) => String(x.id));
      for (const part of chunks(ids, 500)) await q(`DELETE FROM ${T.files} WHERE id IN (?)`, [part]);
      forgetFiles(ids);
      tables = [T.files];
    }
  } else if (type === "conversations") {
    const meta = await q<RowDataPacket[]>(
      `SELECT f AS id FROM ${T.hash} WHERE k = ? AND CAST(JSON_EXTRACT(v, '$.updatedAt') AS UNSIGNED) < ?`,
      [P + "conv:meta", cutoff],
    );
    const ids = meta.map((x) => String(x.id));
    res.count = ids.length;
    if (ids.length) {
      let n = 0;
      for (const part of chunks(ids, 500)) {
        const s = await q<RowDataPacket[]>(`SELECT COALESCE(SUM(LENGTH(v)), 0) AS n FROM ${T.kv} WHERE k IN (?)`, [part.map((id) => P + "conv:" + id)]);
        n += Number(s[0]?.n) || 0;
      }
      res.bytes = n;
    }
    if (!dryRun && ids.length) {
      for (const part of chunks(ids, 500)) {
        await q(`DELETE FROM ${T.kv} WHERE k IN (?)`, [part.map((id) => P + "conv:" + id)]);
        await q(`DELETE FROM ${T.hash} WHERE k = ? AND f IN (?)`, [P + "conv:meta", part]);
      }
      tables = [T.kv, T.hash];
    }
  } else throw new Error("不认识的清理类型");

  if (!dryRun) {
    res.applied = true;
    const before = (await getDbSnapshot())?.usedBytes;
    // InnoDB 删掉的行不会自动把磁盘还回去，重建一下表才会真正变小
    for (const t of tables) await q(`OPTIMIZE TABLE ${t}`).catch(() => null);
    res.usage = await refreshDbSnapshot();
    if (before != null && res.usage) res.freedBytes = Math.max(0, before - res.usage.usedBytes);
  }
  return res;
}

function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
