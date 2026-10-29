// MySQL 存储专项测试：登录失败计数（incr + 过期）、日志只留 500 条、图片压缩、图片总量上限与清理、图库隐藏已清理的图。
// 前提：先 node tests/db-reset.mjs 清空测试库，再用 DB_IMAGES_MAX_MB=2 启动 next start（端口 3100）和 mock.mjs。
// 用法：DATABASE_URL=... DATABASE_CA_CERT=... node tests/mysql-test.mjs
import fs from "node:fs";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import sharp from "sharp";

const APP = process.env.APP || "http://127.0.0.1:3100";
const MOCK = process.env.MOCK || "http://127.0.0.1:9100";
let cookie = "";
let pass = 0;
const failures = [];
function check(name, cond, info) {
  if (cond) {
    pass++;
    console.log("  ✓", name);
  } else {
    failures.push(name);
    console.log("  ✗", name, info !== undefined ? JSON.stringify(info).slice(0, 400) : "");
  }
}
async function ui(path, { method = "GET", body, form } = {}) {
  const r = await fetch(APP + path, {
    method,
    redirect: "manual",
    headers: { cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: form || (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = t;
  }
  return { status: r.status, body: j };
}

const u = new URL(process.env.DATABASE_URL);
const ca = process.env.DATABASE_CA_FILE ? fs.readFileSync(process.env.DATABASE_CA_FILE, "utf8") : process.env.DATABASE_CA_CERT;
const db = await mysql.createConnection({
  host: u.hostname,
  port: Number(u.port || 3306),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1) || "defaultdb",
  ssl: ca ? { ca } : { rejectUnauthorized: false },
});
const sql = async (s, p = []) => (await db.query(s, p))[0];

async function upload(buf, type, name) {
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type }), name);
  return ui("/api/upload", { method: "POST", form: fd });
}
// 随机噪点图几乎无法压缩，用来模拟体积很大的生成图
const noisePng = (w, h) => sharp(crypto.randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();

console.log("\n[1] 登录失败计数");
let r = await ui("/api/auth/setup", { method: "POST", body: { password: "test1234" } });
check("设密码成功", r.status === 200, r);
check("自动建好四张表", (await sql("SHOW TABLES LIKE 'prism\\_%'")).length === 4);
const saved = cookie;
cookie = "";
for (let i = 0; i < 10; i++) await ui("/api/auth/login", { method: "POST", body: { password: "wrong" } });
let row = (await sql("SELECT v, exp FROM prism_kv WHERE k = 'prism:login:fail'"))[0];
check("连续输错 10 次，计数是 10，并且带过期时间", row && row.v === "10" && Number(row.exp) > Date.now() + 500_000, row);
r = await ui("/api/auth/login", { method: "POST", body: { password: "test1234" } });
check("第 11 次即使密码对也被锁住（429）", r.status === 429, r);
await sql("UPDATE prism_kv SET exp = ? WHERE k = 'prism:login:fail'", [Date.now() - 1000]);
r = await ui("/api/auth/login", { method: "POST", body: { password: "wrong" } });
row = (await sql("SELECT v, exp FROM prism_kv WHERE k = 'prism:login:fail'"))[0];
check("计数过期后重新从 1 开始", r.status === 401 && row?.v === "1" && Number(row.exp) > Date.now(), row);
r = await ui("/api/auth/login", { method: "POST", body: { password: "test1234" } });
row = (await sql("SELECT v FROM prism_kv WHERE k = 'prism:login:fail'"))[0];
check("登录成功后计数被删掉", r.status === 200 && !row, row);
if (!cookie) cookie = saved;

console.log("\n[2] 图片压缩");
const small = await noisePng(32, 32);
r = await upload(small, "image/png", "s.png");
check("小图（<200KB）原样保存为 PNG", r.status === 200 && r.body.url?.endsWith(".png"), r.body);
let f = await fetch(APP + r.body.url);
let b = Buffer.from(await f.arrayBuffer());
check("小图内容不变", b.equals(small), [b.length, small.length]);
const big = await noisePng(1100, 1100);
r = await upload(big, "image/png", "b.png");
const firstBig = r.body.url;
f = await fetch(APP + r.body.url);
b = Buffer.from(await f.arrayBuffer());
check(
  `大图（${(big.length / 1024).toFixed(0)}KB PNG）压成 WebP 且不超过 800KB（实际 ${(b.length / 1024).toFixed(0)}KB）`,
  r.body.url?.endsWith(".webp") && f.headers.get("content-type") === "image/webp" && b.length <= 800 * 1024,
  r.body,
);
const meta = await sharp(b).metadata();
check(`压缩后是合法图片（${meta.width}×${meta.height}）`, meta.format === "webp" && meta.width > 0);

console.log("\n[3] 图片总量上限（本测试用 DB_IMAGES_MAX_MB=2）");
for (let i = 0; i < 5; i++) await upload(await noisePng(1100, 1100), "image/png", `n${i}.png`);
const [{ total, n }] = await sql("SELECT COALESCE(SUM(size),0) total, COUNT(*) n FROM prism_files");
check(`总量保持在 2MB 以内（现在 ${(total / 1024).toFixed(0)}KB，${n} 张）`, Number(total) <= 2 * 1024 * 1024);
f = await fetch(APP + firstBig);
check("最早的大图已被清理（404）", f.status === 404, f.status);

console.log("\n[4] 图库隐藏已清理的图片");
const ch = (await ui("/api/channels", { method: "POST", body: { type: "openai", baseUrl: `${MOCK}/oa`, key: "sk-oa-123456", name: "模拟 OpenAI" } })).body.channel;
await ui(`/api/channels/${ch.id}`, { method: "PATCH", body: { models: ["gpt-4o", "gpt-image-1"] } });
for (let i = 0; i < 2; i++) await ui("/api/images", { method: "POST", body: { model: "gpt-image-1", prompt: "图库测试" + i, n: 1, size: "1024x1024" } });
r = await ui("/api/gallery");
const items = r.body.items || r.body.gallery || r.body;
check("图库里有 2 张生成的图", Array.isArray(items) && items.length === 2, r.body);
const victim = items[0].url.slice("/api/files/".length).split(".")[0];
await sql("DELETE FROM prism_files WHERE id = ?", [victim]);
r = await ui("/api/gallery");
const items2 = r.body.items || r.body.gallery || r.body;
check("文件被清理后，图库只剩 1 张", Array.isArray(items2) && items2.length === 1 && items2[0].url !== items[0].url, items2);

console.log("\n[5] 请求日志只留最近 500 条");
const token = (await ui("/api/token")).body.token;
let sent = 0;
const one = () =>
  fetch(APP + "/v1/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi " + sent++ }] }),
  }).then((x) => x.text());
for (let i = 0; i < 106; i++) await Promise.all([one(), one(), one(), one(), one()]);
const [{ c }] = await sql("SELECT COUNT(*) c FROM prism_list WHERE k = 'prism:logs'");
r = await ui("/api/logs");
const logs = r.body.logs || r.body.items || r.body;
check(`发了 ${sent} 个请求，数据库里留 ${c} 条`, sent === 530 && Number(c) === 500, { sent, c });
check("日志接口返回 500 条，最新的在前", Array.isArray(logs) && logs.length === 500 && logs[0].at >= logs[499].at, Array.isArray(logs) ? logs.length : r.body);

await db.end();
console.log(`\nMySQL 专项测试：${pass} 项通过，${failures.length} 项失败`);
if (failures.length) {
  console.log("失败：", failures);
  process.exit(1);
}
