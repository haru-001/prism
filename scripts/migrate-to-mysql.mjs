#!/usr/bin/env node
// 把旧数据搬进 MySQL（Aiven for MySQL）。
//
// 来源二选一：
//   1. 旧的 Upstash Redis / Vercel KV：设置 UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
//      （或 KV_REST_API_URL + KV_REST_API_TOKEN）
//   2. 本地文件：--from-file .data/kv.json
// 目标：DATABASE_URL（Aiven 的 Service URI），CA 证书用 DATABASE_CA_FILE=./ca.pem 或 DATABASE_CA_CERT
//
// 参数：
//   --dry-run     只读取、统计，不写入
//   --overwrite   目标库里已经有 Prism 数据时，先清空再写入（不加就拒绝执行）
//
// 示例：
//   UPSTASH_REDIS_REST_URL=https://xxx.upstash.io UPSTASH_REDIS_REST_TOKEN=xxx \
//   DATABASE_URL='mysql://avnadmin:密码@主机:端口/defaultdb?ssl-mode=REQUIRED' DATABASE_CA_FILE=./ca.pem \
//   node scripts/migrate-to-mysql.mjs
//
// 说明：只搬 prism: 开头的键。旧库里的图片（prism:file:*）搬进 prism_files 表，地址不变；
// 存在 Vercel Blob 里的图片不用搬，继续从 Blob 读。PRISM_SECRET 必须和以前一样，否则上游 Key 解不开。

import fs from "node:fs";
import mysql from "mysql2/promise";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const OVERWRITE = args.includes("--overwrite");
const fileArg = args.includes("--from-file") ? args[args.indexOf("--from-file") + 1] : "";
const PREFIX = "prism:";
const LISTS = new Set(["prism:logs", "prism:gallery"]);
const HASHES = new Set(["prism:conv:meta"]);

// 和 lib/server/mysql.ts 里的 SCHEMA 保持一致
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS prism_kv (
    k VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    v LONGTEXT NOT NULL,
    exp BIGINT NULL,
    PRIMARY KEY (k),
    KEY idx_exp (exp)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS prism_hash (
    k VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    f VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    v LONGTEXT NOT NULL,
    PRIMARY KEY (k, f)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS prism_list (
    id BIGINT NOT NULL AUTO_INCREMENT,
    k VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    v LONGTEXT NOT NULL,
    PRIMARY KEY (id),
    KEY idx_k_id (k, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS prism_files (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    mime VARCHAR(64) NOT NULL,
    size INT NOT NULL,
    data MEDIUMBLOB NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (id),
    KEY idx_created (created_at)
  ) ENGINE=InnoDB`,
];

function die(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

// ---------- 读来源，统一成 { kv: [{k, v, exp}], hash: [{k, f, v}], list: [{k, items(最新在前)}], files: [{id, mime, data}] } ----------

const out = { kv: [], hash: [], list: [], files: [] };

function addFile(key, v) {
  const id = key.slice((PREFIX + "file:").length);
  if (v && typeof v === "object" && typeof v.data === "string") out.files.push({ id, mime: v.mime || "application/octet-stream", data: Buffer.from(v.data, "base64") });
}

async function fromFile(path) {
  const data = JSON.parse(fs.readFileSync(path, "utf8"));
  for (const [k, e] of Object.entries(data)) {
    if (!k.startsWith(PREFIX)) continue;
    if (e.exp && e.exp < Date.now()) continue;
    if (k.startsWith(PREFIX + "file:")) addFile(k, e.v);
    else if (LISTS.has(k)) out.list.push({ k, items: e.v || [] });
    else if (HASHES.has(k)) for (const [f, v] of Object.entries(e.v || {})) out.hash.push({ k, f, v });
    else out.kv.push({ k, v: e.v, exp: e.exp || null });
  }
}

async function fromUpstash(url, token) {
  const base = url.replace(/\/+$/, "");
  const cmd = async (...c) => {
    const r = await fetch(base, { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(c) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) die(`Upstash 返回错误（${c[0]}）：${j.error || r.status}`);
    return j.result;
  };
  // 旧版用 @upstash/redis 写入：对象存成 JSON 字符串，字符串原样存；读的时候能解析就解析
  const auto = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  };
  const keys = new Set();
  let cursor = "0";
  do {
    const [next, batch] = await cmd("SCAN", cursor, "MATCH", PREFIX + "*", "COUNT", "500");
    batch.forEach((k) => keys.add(k));
    cursor = String(next);
  } while (cursor !== "0");
  for (const k of keys) {
    const type = await cmd("TYPE", k);
    if (type === "string") {
      const raw = await cmd("GET", k);
      if (raw == null) continue;
      if (k.startsWith(PREFIX + "file:")) {
        addFile(k, auto(raw));
        continue;
      }
      const pttl = Number(await cmd("PTTL", k));
      out.kv.push({ k, v: auto(raw), exp: pttl > 0 ? Date.now() + pttl : null });
    } else if (type === "list") {
      const items = await cmd("LRANGE", k, "0", "-1");
      out.list.push({ k, items: items.map(auto) });
    } else if (type === "hash") {
      const flat = await cmd("HGETALL", k);
      for (let i = 0; i < flat.length; i += 2) out.hash.push({ k, f: flat[i], v: auto(flat[i + 1]) });
    } else if (type !== "none") console.warn(`  跳过 ${k}：不认识的类型 ${type}`);
  }
}

// ---------- 写进 MySQL ----------

function connOptions() {
  const raw = process.env.DATABASE_URL || process.env.MYSQL_URL;
  if (!raw) die("没有 DATABASE_URL（填 Aiven 控制台里的 Service URI）");
  let u;
  try {
    u = new URL(raw);
  } catch {
    die("DATABASE_URL 格式不对，应该长这样：mysql://avnadmin:密码@主机:端口/defaultdb?ssl-mode=REQUIRED");
  }
  let ca = process.env.DATABASE_CA_FILE ? fs.readFileSync(process.env.DATABASE_CA_FILE, "utf8") : process.env.DATABASE_CA_CERT || "";
  if (ca && !ca.includes("-----BEGIN")) ca = Buffer.from(ca, "base64").toString("utf8");
  ca = ca.replace(/\\n/g, "\n");
  const blocks = [...ca.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)];
  if (blocks.length) ca = blocks.map((m) => `-----BEGIN CERTIFICATE-----\n${m[1].replace(/\s+/g, "").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`).join("");
  const mode = (u.searchParams.get("ssl-mode") || "").toUpperCase();
  const local = ["localhost", "127.0.0.1"].includes(u.hostname);
  let ssl;
  if (mode === "DISABLED" || (local && !mode && !ca)) ssl = undefined;
  else if (ca) ssl = { ca, rejectUnauthorized: true };
  else {
    console.warn("  提示：没有提供 CA 证书，连接仍加密但不校验服务器证书");
    ssl = { rejectUnauthorized: false };
  }
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)) || "defaultdb",
    ssl,
    charset: "utf8mb4",
  };
}

const J = (v) => (v === undefined ? "null" : JSON.stringify(v));

async function main() {
  const upUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const upToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (fileArg) {
    console.log(`读取本地文件 ${fileArg} …`);
    await fromFile(fileArg);
  } else if (upUrl && upToken) {
    console.log(`读取 Upstash（${new URL(upUrl).host}）…`);
    await fromUpstash(upUrl, upToken);
  } else die("没有数据来源：设置 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN，或者用 --from-file .data/kv.json");

  const listItems = out.list.reduce((n, l) => n + l.items.length, 0);
  const fileBytes = out.files.reduce((n, f) => n + f.data.length, 0);
  console.log(`读到：普通键 ${out.kv.length} 个，对话索引 ${out.hash.length} 条，列表 ${out.list.length} 个（共 ${listItems} 条），图片 ${out.files.length} 张（${(fileBytes / 1024 / 1024).toFixed(1)}MB）`);
  if (DRY) {
    console.log("--dry-run：不写入。");
    return;
  }

  const db = await mysql.createConnection(connOptions());
  try {
    for (const s of SCHEMA) await db.query(s);
    const [[{ n }]] = await db.query("SELECT COUNT(*) n FROM prism_kv");
    if (n > 0 && !OVERWRITE) die(`目标库里已经有 ${n} 条 Prism 数据。确定要用旧数据覆盖的话，加上 --overwrite 再运行。`);
    await db.beginTransaction();
    if (OVERWRITE) for (const t of ["prism_kv", "prism_hash", "prism_list", "prism_files"]) await db.query(`DELETE FROM ${t}`);
    for (const r of out.kv) await db.query("INSERT INTO prism_kv (k, v, exp) VALUES (?, ?, ?)", [r.k, J(r.v), r.exp]);
    for (const r of out.hash) await db.query("INSERT INTO prism_hash (k, f, v) VALUES (?, ?, ?)", [r.k, r.f, J(r.v)]);
    // 列表里最新的在前；从最旧的开始插，自增 id 的顺序才和原来一致
    for (const l of out.list) for (const item of [...l.items].reverse()) await db.query("INSERT INTO prism_list (k, v) VALUES (?, ?)", [l.k, J(item)]);
    const now = Date.now();
    for (const [i, f] of out.files.entries()) await db.query("INSERT INTO prism_files (id, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?)", [f.id, f.mime, f.data.length, f.data, now - out.files.length + i]);
    await db.commit();
  } catch (e) {
    await db.rollback().catch(() => {});
    die("写入失败，已回滚：" + (e?.message || e));
  } finally {
    await db.end();
  }
  console.log("✓ 迁移完成。把 Vercel 里的 DATABASE_URL / DATABASE_CA_CERT 配好并重新部署，就能用旧密码登录了。");
}

main();
