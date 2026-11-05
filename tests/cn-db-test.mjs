// 国内访问和数据库功能测试：签名图片地址和登录鉴权、旧链接改写、上游临时链接转存、外链转发防护、
// 数据库休眠提示（含三种对外格式的 503 和 Retry-After）、容量统计、清理预览和确认删除、80% 提醒
//
// 需要：MySQL 测试库（DATABASE_URL / DATABASE_CA_CERT）、mock.mjs（9100），以及用下面的环境变量启动的 next start（3100）：
//   PRISM_TEST_BLOB_ORIGIN=http://127.0.0.1:9100/blob      公开 Blob 的读取转到 mock
//   PRISM_ALLOW_PRIVATE_IMAGE_FETCH=127.0.0.1:9100          外链转发只放行 mock 这一个内网地址
// 休眠、配置错误、80% 提醒这几项会由本脚本另外启动几个 next start（3102~3105），跑完自动关掉。
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
import mysql from "mysql2/promise";

const APP = process.env.APP || "http://127.0.0.1:3100";
const MOCK = process.env.MOCK || "http://127.0.0.1:9100";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let cookie = "";
let pass = 0;
let fail = 0;
const failures = [];
const procs = [];

function check(name, cond, info) {
  if (cond) {
    pass++;
    console.log("  ✓", name);
  } else {
    fail++;
    failures.push(name);
    console.log("  ✗", name, info !== undefined ? JSON.stringify(info).slice(0, 600) : "");
  }
}

async function ui(path, { method = "GET", body, base = APP, headers = {} } = {}) {
  const r = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: { cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get("set-cookie");
  if (sc && base === APP) cookie = sc.split(";")[0];
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = t;
  }
  return { status: r.status, body: j, text: t, headers: r.headers };
}

const ext = (path, { body, headers = {}, base = APP } = {}) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const get = (url, headers = {}) => fetch(new URL(url, APP), { headers, redirect: "manual" });
const bytes = async (r) => Buffer.from(await r.arrayBuffer());
const mockLog = async () => (await fetch(MOCK + "/_log")).json();
const mockReset = () => fetch(MOCK + "/_reset");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIGNED_DB = /^\/api\/files\/[\w-]+\.(png|webp|jpg)\?s=[\w-]{22}$/;

function db() {
  const u = new URL(process.env.DATABASE_URL);
  const ca = process.env.DATABASE_CA_FILE ? fs.readFileSync(process.env.DATABASE_CA_FILE, "utf8") : process.env.DATABASE_CA_CERT;
  return mysql.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1) || "defaultdb",
    ssl: ca ? { ca } : { rejectUnauthorized: false },
  });
}

/** 另起一个 next start（同一份构建），用不同的数据库配置 */
async function startNext(port, env) {
  const p = spawn("npx", ["next", "start", "-p", String(port)], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  procs.push(p);
  for (let i = 0; i < 60; i++) {
    if (/Ready in|started server|Local:/.test(out)) break;
    await sleep(500);
  }
  await sleep(300);
  return { base: `http://127.0.0.1:${port}`, log: () => out };
}

function stopAll() {
  for (const p of procs) {
    try {
      process.kill(-p.pid, "SIGTERM");
    } catch {}
  }
}

function openBackup(text, pw) {
  const env = JSON.parse(text);
  const key = crypto.scryptSync(pw, Buffer.from(env.kdf.salt, "base64"), 32, { N: env.kdf.N, r: env.kdf.r, p: env.kdf.p, maxmem: 64 * 1024 * 1024 });
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
  d.setAuthTag(Buffer.from(env.tag, "base64"));
  return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(Buffer.from(env.data, "base64")), d.final()])).toString());
}

/** 找出一段 JSON 里所有浏览器会拿去加载的图片地址（images 数组、url / src / thumb 字段） */
function imageFields(obj, out = []) {
  if (Array.isArray(obj)) obj.forEach((x) => imageFields(x, out));
  else if (obj && typeof obj === "object")
    for (const [k, v] of Object.entries(obj)) {
      if (k === "images" && Array.isArray(v)) v.forEach((x) => typeof x === "string" && out.push(x));
      else if (["url", "src", "thumb"].includes(k) && typeof v === "string") out.push(v);
      else imageFields(v, out);
    }
  return out;
}
const isLocal = (u) => u.startsWith("/") || u.startsWith("data:") || u.startsWith(APP + "/");

async function main() {
  console.log("\n[0] 准备：设密码、加渠道");
  let r = await ui("/api/auth/setup", { method: "POST", body: { password: "test1234" } });
  check("设密码并登录", r.status === 200 && cookie, r.body);
  const mk = async (body) => (await ui("/api/channels", { method: "POST", body })).body.channel;
  const URLCH = await mk({ type: "openai", baseUrl: `${MOCK}/oaurl`, key: "sk-url-1", name: "临时链接上游" });
  const BADCH = await mk({ type: "openai", baseUrl: `${MOCK}/oaurlbad`, key: "sk-url-2", name: "链接已失效上游" });
  const OA = await mk({ type: "openai", baseUrl: `${MOCK}/oa`, key: "sk-oa-1", name: "模拟 OpenAI" });
  await ui(`/api/channels/${URLCH.id}`, { method: "PATCH", body: { models: ["dall-e-3"] } });
  await ui(`/api/channels/${BADCH.id}`, { method: "PATCH", body: { models: ["gpt-image-1"] } });
  await ui(`/api/channels/${OA.id}`, { method: "PATCH", body: { models: ["gpt-4o-mini"] } });
  await ui("/api/onboarding", { method: "PUT", body: { completed: true } });
  const TOKEN = (await ui("/api/token")).body.token;
  check("拿到默认令牌", typeof TOKEN === "string" && TOKEN.length > 10, TOKEN);

  // ================= 1. 上游临时链接转存 =================
  console.log("\n[1] 上游生图给临时链接：服务端立刻下载存好");
  await mockReset();
  r = await ui("/api/images", { method: "POST", body: { model: "dall-e-3", prompt: "临时链接测试", n: 2, size: "1024x1024" } });
  const imgs = r.body.images || [];
  check("聊天页生图返回 2 张本站地址（带签名）", imgs.length === 2 && imgs.every((u) => SIGNED_DB.test(u)), r.body);
  check("返回里没有上游的临时链接", !r.text.includes("127.0.0.1:9100") && !r.text.includes("sig=abc"), r.text.slice(0, 300));
  let log = await mockLog();
  check("服务端各下载了一次临时图片", log.filter((l) => l.path.startsWith("/tmpimg/gen-")).length === 2, log.map((l) => l.path));
  r = await ui("/api/gallery");
  const gItems = (r.body.items || []).filter((i) => i.prompt === "临时链接测试");
  check("图库里存的是本站地址", gItems.length === 2 && gItems.every((i) => SIGNED_DB.test(i.url)), r.body.items);

  await mockReset();
  r = await ui("/api/images", { method: "POST", body: { model: "gpt-image-1", prompt: "失效链接测试", n: 1 } });
  const fb = r.body.images?.[0] || "";
  check("临时链接下载失败：给经本站转发的地址", /^\/api\/files\/ext\?u=[^&]+&s=[\w-]{22}$/.test(fb), r.body);
  check("失败地址里也没有明文的上游链接", !r.text.includes("http://127.0.0.1:9100"), r.text.slice(0, 300));
  log = await mockLog();
  check("下载失败会再试一次", log.filter((l) => l.path.startsWith("/gone/")).length === 2, log.map((l) => l.path));

  console.log("\n[2] /v1/images/generations 返回本站地址");
  await mockReset();
  let res = await ext("/v1/images/generations", { headers: { authorization: "Bearer " + TOKEN }, body: { model: "dall-e-3", prompt: "接口生图", n: 1 } });
  let j = await res.json();
  const u1 = j.data?.[0]?.url || "";
  check("url 是本站完整地址（带签名）", res.status === 200 && u1.startsWith(APP + "/api/files/") && /\?s=[\w-]{22}$/.test(u1), j);
  check("其他字段原样保留（revised_prompt）", j.data?.[0]?.revised_prompt === "mock: 接口生图", j);
  res = await get(u1);
  check("不登录也能用这个地址打开图片", res.status === 200 && res.headers.get("content-type") === "image/png" && (await bytes(res)).equals(PNG), res.status);
  res = await ext("/v1/images/generations", {
    headers: { authorization: "Bearer " + TOKEN, "x-forwarded-host": "prism.example.com", "x-forwarded-proto": "https" },
    body: { model: "dall-e-3", prompt: "自定义域名", n: 1 },
  });
  j = await res.json();
  check("绑了自己的域名时用那个域名", j.data?.[0]?.url?.startsWith("https://prism.example.com/api/files/"), j);
  res = await ext("/v1/images/generations", { headers: { authorization: "Bearer " + TOKEN }, body: { model: "dall-e-3", prompt: "要 base64", response_format: "b64_json" } });
  j = await res.json();
  check("response_format=b64_json：服务端下载后给 base64", res.status === 200 && j.data?.[0]?.b64_json && Buffer.from(j.data[0].b64_json, "base64").equals(PNG), JSON.stringify(j).slice(0, 200));

  // ================= 3. 签名地址和登录鉴权 =================
  console.log("\n[3] 签名地址和登录鉴权");
  const [A, B] = imgs;
  const plainA = A.split("?")[0];
  res = await get(A);
  check("带签名、不登录：能打开", res.status === 200 && (await bytes(res)).equals(PNG), res.status);
  check("带签名：浏览器和 CDN 都缓存一年", res.headers.get("cache-control") === "public, max-age=31536000, immutable" && res.headers.get("cdn-cache-control") === "public, max-age=31536000, immutable", Object.fromEntries(res.headers));
  check("图片响应禁止执行脚本", res.headers.get("x-content-type-options") === "nosniff" && /sandbox/.test(res.headers.get("content-security-policy") || ""), Object.fromEntries(res.headers));
  res = await get(plainA);
  check("不带签名、不登录：401", res.status === 401, res.status);
  res = await get(plainA, { cookie });
  check("不带签名、已登录：能打开", res.status === 200 && (await bytes(res)).equals(PNG), res.status);
  check("不带签名：只让浏览器自己缓存，CDN 不缓存", res.headers.get("cache-control")?.startsWith("private") && !res.headers.get("cdn-cache-control"), Object.fromEntries(res.headers));
  const sA = A.split("s=")[1];
  const flipped = sA.slice(0, -1) + (sA.endsWith("A") ? "B" : "A");
  res = await get(plainA + "?s=" + flipped);
  check("签名改了一位：401", res.status === 401, res.status);
  res = await get(B.split("?")[0] + "?s=" + sA);
  check("拿 A 图的签名去开 B 图：401", res.status === 401, res.status);
  res = await get(A + "&w=256");
  check("签名地址加缩略图参数也能打开", res.status === 200 && res.headers.get("content-type")?.startsWith("image/"), res.status);

  // ================= 4. 旧链接改写 =================
  console.log("\n[4] 旧数据里的 Blob 直链和上游链接：读取时自动改写");
  const BLOB = "https://abcd1234.public.blob.vercel-storage.com/prism/images/old1.png";
  const DALLE = "https://oaidalleapiprodscus.blob.core.windows.net/private/org/img-x.png?se=2026&sig=zz";
  const UP = `${MOCK}/tmpimg/legacy-upstream.png`;
  const convId = "cnlegacy1";
  const now = Date.now();
  r = await ui(`/api/conversations/${convId}`, {
    method: "PUT",
    body: {
      title: "旧图片对话",
      createdAt: now,
      messages: [
        { id: "m1", role: "user", text: "看图", images: [BLOB, "/api/files/oldlocal.png"], createdAt: now },
        { id: "m2", role: "assistant", mode: "image", text: "", images: [DALLE, UP], createdAt: now },
        { id: "m3", role: "assistant", text: `这是图：![示例](${MOCK}/tmpimg/md.png)`, createdAt: now },
      ],
    },
  });
  check("写入一段带旧链接的对话", r.status === 200, r.body);
  r = await ui(`/api/conversations/${convId}`);
  const ms = r.body.conversation?.messages || [];
  const [i0, i1] = ms[0]?.images || [];
  const [i2, i3] = ms[1]?.images || [];
  check("公开 Blob 直链 → /api/files/bp/...（带签名）", /^\/api\/files\/bp\/abcd1234\.public\.blob\.vercel-storage\.com\/prism\/images\/old1\.png\?s=[\w-]{22}$/.test(i0 || ""), i0);
  check("旧的站内地址补上签名", /^\/api\/files\/oldlocal\.png\?s=[\w-]{22}$/.test(i1 || ""), i1);
  check("上游临时链接 → /api/files/ext?u=...（带签名）", /^\/api\/files\/ext\?u=[^&]+&s=[\w-]{22}$/.test(i2 || "") && decodeURIComponent(i2.split("u=")[1].split("&")[0]) === DALLE, i2);
  check("对话接口里没有任何外部图片地址", imageFields(r.body).every(isLocal), imageFields(r.body));
  await mockReset();
  res = await get(i0);
  log = await mockLog();
  check("改写后的 Blob 图不登录也能打开（服务端去读 Blob）", res.status === 200 && (await bytes(res)).equals(PNG), res.status);
  check("服务端读的正是原来的 Blob 文件", log.some((l) => l.path === "/blob/abcd1234.public.blob.vercel-storage.com/prism/images/old1.png"), log.map((l) => l.path));
  res = await get(i3);
  check("改写后的上游链接经本站转发能打开", res.status === 200 && (await bytes(res)).equals(PNG), res.status);
  check("外链转发只缓存 7 天", res.headers.get("cache-control") === "public, max-age=604800, immutable", res.headers.get("cache-control"));
  const forged = i3.replace(encodeURIComponent(UP), encodeURIComponent(`${MOCK}/tmpimg/other.png`));
  res = await get(forged);
  check("换掉 u= 但沿用签名：401", forged !== i3 && res.status === 401, { status: res.status, i3 });
  res = await get("/api/files/bp/evil.example.com/x.png", { cookie });
  check("bp 只认 Vercel Blob 的域名", res.status === 404 || res.status === 400, res.status);

  r = await ui("/api/conversations");
  check("会话列表接口里没有外部图片地址", imageFields(r.body).every(isLocal), imageFields(r.body));

  // 图库里的旧数据：直接写进库
  const c = await db();
  await c.query("INSERT INTO prism_list (k, v) VALUES (?, ?)", ["prism:gallery", JSON.stringify({ id: "legacyg1", url: "https://abcd1234.public.blob.vercel-storage.com/prism/images/old2.png", prompt: "旧图库图片", model: "dall-e-3", createdAt: now - 1000 })]);
  await c.query("INSERT INTO prism_list (k, v) VALUES (?, ?)", ["prism:gallery", JSON.stringify({ id: "legacyg2", url: DALLE, prompt: "旧上游链接", model: "dall-e-3", createdAt: now - 2000 })]);
  r = await ui("/api/gallery");
  const lg1 = r.body.items?.find((i) => i.id === "legacyg1");
  const lg2 = r.body.items?.find((i) => i.id === "legacyg2");
  check("图库：旧 Blob 直链改写成本站地址", lg1?.url?.startsWith("/api/files/bp/abcd1234.public.blob.vercel-storage.com/prism/images/old2.png?s="), lg1);
  check("图库：旧上游链接改写成本站转发地址", lg2?.url?.startsWith("/api/files/ext?u="), lg2);
  check("图库接口里没有外部图片地址", imageFields(r.body).every(isLocal), imageFields(r.body).filter((u) => !isLocal(u)));

  res = await get(`/api/conversations/${convId}/export?format=md`, { cookie });
  const md = await res.text();
  check("导出 Markdown：图片是本站完整地址", md.includes(`${APP}/api/files/bp/abcd1234.public.blob.vercel-storage.com/prism/images/old1.png?s=`) && md.includes(`${APP}/api/files/ext?u=`), md);
  check("导出 Markdown：没有 Blob 直链和上游临时链接", !md.includes("https://abcd1234") && !md.includes("https://oaidalle"), md);
  res = await get(`/api/conversations/${convId}/export?format=json`, { cookie });
  j = await res.json();
  check("导出 JSON：图片也改写了", imageFields(j).every(isLocal) && imageFields(j).length >= 4, imageFields(j));
  res = await fetch(APP + "/api/backup/export", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ password: "backup-pass", sections: ["conversations"] }) });
  const inner = openBackup(await res.text(), "backup-pass");
  const bconv = inner.conversations?.find((x) => x.id === convId);
  check("备份里的会话图片也改写了", bconv && imageFields(bconv).every(isLocal), bconv && imageFields(bconv));

  // ================= 5. 外链转发的防护 =================
  console.log("\n[5] 外链转发：防内网访问、只收图片");
  const proxy = (u) => get("/api/files/ext?u=" + encodeURIComponent(u), { cookie });
  res = await proxy(`${MOCK}/tmpimg/ok.png`);
  check("放行的地址：正常转发", res.status === 200 && res.headers.get("content-type") === "image/png", res.status);
  res = await proxy(`${MOCK}/redir-ok`);
  check("跟随跳转到图片", res.status === 200 && (await bytes(res)).equals(PNG), res.status);
  res = await proxy(`${MOCK}/redir-private`);
  check("跳转到内网地址：拦下", res.status === 502, { status: res.status, t: await res.text() });
  res = await proxy("http://127.0.0.1:3100/login");
  check("直接访问站点自己：拦下", res.status === 502, res.status);
  const t0 = Date.now();
  res = await proxy("http://10.1.2.3/x.png");
  check("访问 10.x 内网：立刻拦下，不去连", res.status === 502 && Date.now() - t0 < 2000, { status: res.status, ms: Date.now() - t0 });
  res = await proxy("http://169.254.169.254/latest/meta-data");
  check("访问云元数据地址：拦下", res.status === 502, res.status);
  res = await proxy("file:///etc/passwd");
  check("file:// 地址：拒绝", res.status >= 400, res.status);
  res = await proxy(`${MOCK}/notimg`);
  check("返回的不是图片：拒绝", res.status === 502, res.status);
  res = await proxy(`${MOCK}/tmpimg/octet-stream.png`);
  check("类型写成 octet-stream 但内容是图片：按内容识别", res.status === 200 && res.headers.get("content-type") === "image/png", res.status);
  res = await get("/api/files/ext?u=" + encodeURIComponent(`${MOCK}/tmpimg/ok.png`));
  check("外链转发不带签名、不登录：401", res.status === 401, res.status);

  // ================= 6. 容量统计、清理 =================
  console.log("\n[6] 数据库容量统计和清理");
  for (let i = 0; i < 4; i++)
    await ext("/v1/chat/completions", { headers: { authorization: "Bearer " + TOKEN }, body: { model: "gpt-4o-mini", messages: [{ role: "user", content: "容量测试" + i }] } });
  await sleep(800);
  r = await ui("/api/db/usage");
  const U = r.body;
  const cats = Object.fromEntries((U.categories || []).map((x) => [x.key, x.bytes]));
  check("容量接口：MySQL、额度 1GB", r.status === 200 && U.storage === "mysql" && U.quotaBytes === 1024 ** 3, U);
  check("按图片、会话、请求日志、用量统计、其他分开算", ["images", "conversations", "logs", "usage", "other"].every((k) => typeof cats[k] === "number"), U.categories);
  check("各部分加起来等于总用量", Math.abs(Object.values(cats).reduce((a, b) => a + b, 0) - U.usedBytes) <= 1 && U.usedBytes > 0, { cats, used: U.usedBytes });
  check("默认 80% 提醒", U.warnRatio === 0.8, U.warnRatio);
  r = await ui("/api/bootstrap");
  check("启动数据里带上容量（不用另外轮询）", r.body.db && typeof r.body.db.usedBytes === "number" && r.body.db.ratio < 0.8, r.body.db);

  // 把一部分数据改成很久以前的
  const old = now - 100 * 86400_000;
  const [logs] = await c.query("SELECT id, JSON_UNQUOTE(JSON_EXTRACT(v, '$.id')) AS lid FROM prism_list WHERE k = 'prism:logs' ORDER BY id ASC");
  check("有请求日志可以测", logs.length >= 6, logs.length);
  const oldLogs = logs.slice(0, 3);
  for (const l of oldLogs) await c.query("UPDATE prism_list SET v = JSON_SET(v, '$.at', ?) WHERE id = ?", [old, l.id]);
  await c.query("INSERT INTO prism_usage (day, model, channel, token, requests) VALUES ('2026-01-02', 'old-model', 'old', 'default', 3)");
  const [files] = await c.query("SELECT id FROM prism_files ORDER BY created_at ASC");
  const oldFile = files[0].id;
  await c.query("UPDATE prism_files SET created_at = ? WHERE id = ?", [old, oldFile]);
  await ui(`/api/conversations/cnold1`, { method: "PUT", body: { title: "很久以前的对话", createdAt: old, messages: [{ id: "x", role: "user", text: "旧", createdAt: old }] } });
  await c.query("UPDATE prism_hash SET v = JSON_SET(v, '$.updatedAt', ?) WHERE k = 'prism:conv:meta' AND f = 'cnold1'", [old]);

  const pv = async (type, days) => (await ui("/api/db/cleanup", { method: "POST", body: { type, olderThanDays: days, confirm: false } })).body;
  const go = async (type, days) => (await ui("/api/db/cleanup", { method: "POST", body: { type, olderThanDays: days, confirm: true } })).body;
  let p = await pv("logs", 30);
  check("预览：30 天前的日志 3 条", p.count === 3 && p.applied === false && p.bytes > 0, p);
  r = await ui("/api/logs");
  const logCountBefore = (r.body.logs || r.body.items || []).length;
  const [[{ n: rowsAfterPreview }]] = await c.query("SELECT COUNT(*) AS n FROM prism_list WHERE k = 'prism:logs'");
  check("预览不删任何数据", rowsAfterPreview === logs.length, { rowsAfterPreview, before: logs.length });
  p = await go("logs", 30);
  check("确认删除：删了 3 条", p.count === 3 && p.applied === true && p.usage?.usedBytes > 0, p);
  const [[{ n: rowsAfter }]] = await c.query("SELECT COUNT(*) AS n FROM prism_list WHERE k = 'prism:logs'");
  check("库里只剩新的日志", rowsAfter === logs.length - 3, rowsAfter);
  const [[{ n: detailLeft }]] = await c.query("SELECT COUNT(*) AS n FROM prism_logd WHERE id IN (?)", [oldLogs.map((l) => l.lid)]);
  check("对应的日志详情一起删了", detailLeft === 0, detailLeft);
  r = await ui("/api/logs");
  const logsNow = r.body.logs || r.body.items || [];
  check("日志页看不到删掉的日志", logsNow.length === logCountBefore - 3 && !logsNow.some((l) => oldLogs.some((o) => o.lid === l.id)), { before: logCountBefore, now: logsNow.length });

  p = await pv("usage", 30);
  check("预览：30 天前的用量统计 1 行", p.count === 1, p);
  p = await go("usage", 30);
  const [[{ n: oldUsage }]] = await c.query("SELECT COUNT(*) AS n FROM prism_usage WHERE day < '2026-02-01'");
  const [[{ n: newUsage }]] = await c.query("SELECT COUNT(*) AS n FROM prism_usage");
  check("用量统计：旧的删掉，最近的保留", p.applied && oldUsage === 0 && newUsage > 0, { oldUsage, newUsage });

  p = await pv("images", 30);
  check("预览：30 天前的图片 1 张", p.count === 1 && p.bytes > 0, p);
  p = await go("images", 30);
  res = await get(`/api/files/${oldFile}`, { cookie });
  check("图片删掉后打不开", p.applied && res.status === 404, res.status);
  r = await ui("/api/gallery");
  check("图库不再显示删掉的图", !(r.body.items || []).some((i) => i.url.includes(oldFile)), (r.body.items || []).map((i) => i.url));
  check("其他图片还在", (r.body.items || []).filter((i) => SIGNED_DB.test(i.url)).length >= 1, (r.body.items || []).length);

  p = await pv("conversations", 30);
  check("预览：30 天没动过的会话 1 个", p.count === 1, p);
  p = await go("conversations", 30);
  r = await ui("/api/conversations/cnold1");
  const r2 = await ui(`/api/conversations/${convId}`);
  check("旧会话删掉，新会话还在", p.applied && r.status === 404 && r2.status === 200, { old: r.status, recent: r2.status });
  r = await ui("/api/conversations");
  check("会话列表里也没有了", !JSON.stringify(r.body).includes("cnold1") && JSON.stringify(r.body).includes(convId), null);

  r = await ui("/api/db/cleanup", { method: "POST", body: { type: "everything", olderThanDays: 0, confirm: true } });
  check("不认识的清理类型：拒绝", r.status === 400, r);
  p = await pv("logs", 0);
  check("选「全部」：预览列出所有日志", p.count === logs.length - 3, p);
  await c.end();

  // ================= 7. 80% 提醒 =================
  console.log("\n[7] 容量超过提醒线");
  const W = await startNext(3105, { DB_WARN_PERCENT: "10", DB_QUOTA_MB: "1" });
  r = await ui("/api/db/usage", { base: W.base });
  check("额度和提醒线可以用 DB_QUOTA_MB、DB_WARN_PERCENT 调（这里设成 1MB、10%）", r.body.quotaBytes === 1024 * 1024 && r.body.warnRatio === 0.1 && r.body.ratio >= 0.1, r.body);
  r = await ui("/api/bootstrap", { base: W.base });
  check("超过提醒线：启动数据里的比例高于提醒线（页面顶部会提醒）", r.body.db?.ratio >= r.body.db?.warnRatio, r.body.db);

  // ================= 8. 数据库休眠 =================
  console.log("\n[8] 数据库连不上（Aiven 免费档被关机）");
  const DOWN = await startNext(3102, { DATABASE_URL: "mysql://avnadmin:x@127.0.0.1:3399/defaultdb?ssl-mode=REQUIRED", PRISM_API_TOKEN: "env-token-123" });
  r = await ui("/api/bootstrap", { base: DOWN.base });
  check("站内接口：503 + 中文说明 + Retry-After", r.status === 503 && r.body.code === "db_sleeping" && /[\u4e00-\u9fa5]/.test(r.body.error) && r.headers.get("retry-after") === "30", { status: r.status, body: r.body });
  r = await ui("/api/db/status", { base: DOWN.base });
  check("状态接口：kind=down", r.status === 503 && r.body.kind === "down", r.body);
  r = await ui("/", { base: DOWN.base });
  check("页面：显示「数据库睡着了」和 Power on 步骤", r.text.includes("数据库睡着了") && r.text.includes("Power on service"), { status: r.status, t: r.text.slice(0, 200) });
  r = await ui("/login", { base: DOWN.base, headers: { cookie: "" } });
  check("登录页也显示「数据库睡着了」", r.text.includes("数据库睡着了"), { status: r.status, t: r.text.slice(0, 200) });
  r = await ui("/onboarding", { base: DOWN.base, headers: { cookie: "" } });
  check("引导页也显示「数据库睡着了」", r.text.includes("数据库睡着了"), { status: r.status, t: r.text.slice(0, 200) });
  const H = { "content-type": "application/json" };
  res = await fetch(DOWN.base + "/v1/chat/completions", { method: "POST", headers: { ...H, authorization: "Bearer env-token-123" }, body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }) });
  j = await res.json();
  check("OpenAI 格式：503 + Retry-After", res.status === 503 && res.headers.get("retry-after") === "30" && j.error?.type === "database_unavailable" && j.error?.message, j);
  res = await fetch(DOWN.base + "/v1/messages", { method: "POST", headers: { ...H, "x-api-key": "env-token-123", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }) });
  j = await res.json();
  check("Claude 格式：503 + Retry-After", res.status === 503 && res.headers.get("retry-after") === "30" && j.type === "error" && j.error?.type && j.error?.message, j);
  res = await fetch(DOWN.base + "/v1beta/models/gemini-2.5-flash:generateContent", { method: "POST", headers: { ...H, "x-goog-api-key": "env-token-123" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }) });
  j = await res.json();
  check("Gemini 格式：503 + Retry-After", res.status === 503 && res.headers.get("retry-after") === "30" && j.error?.code === 503 && j.error?.status === "UNAVAILABLE", j);
  res = await fetch(DOWN.base + "/v1/models", { headers: { authorization: "Bearer env-token-123" } });
  check("/v1/models：503", res.status === 503 && res.headers.get("retry-after") === "30", res.status);
  res = await fetch(DOWN.base + "/v1/images/generations", { method: "POST", headers: { ...H, authorization: "Bearer env-token-123" }, body: JSON.stringify({ model: "dall-e-3", prompt: "x" }) });
  check("/v1/images/generations：503", res.status === 503 && res.headers.get("retry-after") === "30", res.status);
  res = await fetch(DOWN.base + "/v1/chat/completions", { method: "POST", headers: { ...H, authorization: "Bearer sk-wrong" }, body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }) });
  check("数据库连不上时，库里的令牌也是 503（不是 401）", res.status === 503, res.status);

  const SLOW = await startNext(3104, { DATABASE_URL: "mysql://avnadmin:x@10.255.255.1:3306/defaultdb?ssl-mode=REQUIRED" });
  let t1 = Date.now();
  r = await ui("/api/bootstrap", { base: SLOW.base });
  const firstMs = Date.now() - t1;
  t1 = Date.now();
  const r3 = await ui("/api/bootstrap", { base: SLOW.base });
  const secondMs = Date.now() - t1;
  check("连接超时的库：第一次 503，只等一次连接超时（约 10 秒，不重试）", r.status === 503 && r.body.code === "db_sleeping" && firstMs < 13000, { status: r.status, body: r.body, firstMs });
  check("之后 15 秒内不再去连，马上返回提示", r3.status === 503 && secondMs < 1000, { secondMs, firstMs });
  console.log(`    （第一次 ${firstMs} 毫秒，第二次 ${secondMs} 毫秒）`);

  const BAD = await startNext(3103, { DATABASE_URL: "mysql://avnadmin:WrongPw@localhost:3306/defaultdb?ssl-mode=REQUIRED" });
  r = await ui("/api/db/status", { base: BAD.base });
  check("密码不对：kind=config", r.status === 503 && r.body.kind === "config", r.body);
  r = await ui("/api/bootstrap", { base: BAD.base });
  check("站内接口返回 db_config", r.status === 503 && r.body.code === "db_config", r.body);
  r = await ui("/", { base: BAD.base });
  check("页面显示「数据库连不上」和检查配置的提示", r.text.includes("数据库连不上") && r.text.includes("DATABASE_URL"), r.text.slice(0, 200));

  r = await ui("/api/db/status");
  check("正常的实例：状态 ok", r.status === 200 && r.body.ok === true, r.body);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(() => {
    stopAll();
    console.log(`\n结果：${pass} 通过，${fail} 失败`);
    if (fail) {
      console.log("失败项：\n - " + failures.join("\n - "));
      process.exit(1);
    }
    process.exit(0);
  });
