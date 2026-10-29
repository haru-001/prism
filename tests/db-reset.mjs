// 测试前清空 MySQL：删掉 Prism 的四张表（下次启动会自动重建）。只用于测试库，千万别对线上库执行。
// 用法：DATABASE_URL=mysql://... [DATABASE_CA_FILE=ca.pem] node tests/db-reset.mjs
import fs from "node:fs";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("没有 DATABASE_URL");
  process.exit(1);
}
const u = new URL(url);
const ca = process.env.DATABASE_CA_FILE ? fs.readFileSync(process.env.DATABASE_CA_FILE, "utf8") : process.env.DATABASE_CA_CERT;
const c = await mysql.createConnection({
  host: u.hostname,
  port: Number(u.port || 3306),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1) || "defaultdb",
  ssl: ca ? { ca } : { rejectUnauthorized: false },
});
for (const t of ["prism_kv", "prism_hash", "prism_list", "prism_files"]) await c.query(`DROP TABLE IF EXISTS ${t}`);
await c.end();
console.log("已清空 Prism 的数据表");
