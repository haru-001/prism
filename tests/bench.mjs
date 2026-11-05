// 速度基准：量关键接口的耗时、每个请求打几次数据库、首字时间。
// 前提：next start 在 3100（DATABASE_URL 指向 latency-proxy 模拟的远距离库），mock.mjs 在 9100。
// 用法：
//   node tests/bench.mjs setup                 在空库上建好测试数据（密码、渠道、40 个对话、几张图、日志）
//   node tests/bench.mjs cold                  服务刚启动后的第一个请求（冷启动）
//   node tests/bench.mjs run [输出.json]       热状态下每个接口跑 RUNS 次取中位数
// 数据库查询数来自 MySQL 的 general_log（直连 3306，不经过代理），需要 DB_DIRECT_URL 和 CA。
import fs from "node:fs";
import mysql from "mysql2/promise";

const APP = process.env.APP || "http://127.0.0.1:3100";
const MOCK = process.env.MOCK || "http://127.0.0.1:9100";
const RUNS = Number(process.env.RUNS || 7);
const PW = "bench1234";
const STATE = "/tmp/prism-bench-state.json";
let cookie = "";

async function ui(path, { method = "GET", body, headers = {} } = {}) {
  const r = await fetch(APP + path, {
    method,
    redirect: "manual",
    headers: { cookie, ...headers, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const t = await r.text();
  try {
    return { status: r.status, body: JSON.parse(t) };
  } catch {
    return { status: r.status, body: t };
  }
}

// ---------- general_log ----------
let db = null;
async function dbConn() {
  if (db) return db;
  const u = new URL(process.env.DB_DIRECT_URL || process.env.DATABASE_URL);
  const ca = process.env.DATABASE_CA_FILE ? fs.readFileSync(process.env.DATABASE_CA_FILE, "utf8") : process.env.DATABASE_CA_CERT;
  db = await mysql.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1) || "defaultdb",
    ssl: ca ? { ca } : { rejectUnauthorized: false },
  });
  await db.query("SET GLOBAL log_output = 'TABLE'");
  await db.query("SET GLOBAL general_log = 'ON'");
  return db;
}
async function logReset() {
  const c = await dbConn();
  await c.query("TRUNCATE TABLE mysql.general_log");
}
/** 自上次 reset 以来 Prism 打的查询：queries 总数、connects 新建连接数、beforeFirstByte 在响应首字节之前完成的查询数 */
async function logCount(firstByteAt) {
  const c = await dbConn();
  const [rows] = await c.query(
    "SELECT command_type AS t, CONVERT(argument USING utf8mb4) AS a, UNIX_TIMESTAMP(event_time) * 1000 AS at FROM mysql.general_log WHERE thread_id <> CONNECTION_ID()",
  );
  const qs = rows.filter((r) => r.t === "Query" && !/general_log/.test(r.a));
  return {
    queries: qs.length,
    connects: rows.filter((r) => r.t === "Connect").length,
    beforeFirstByte: firstByteAt ? qs.filter((r) => Number(r.at) <= firstByteAt).length : undefined,
    sql: qs.map((r) => r.a.replace(/\s+/g, " ").slice(0, 90)),
  };
}
async function logOff() {
  if (!db) return;
  await db.query("SET GLOBAL general_log = 'OFF'");
  await db.end();
}

// ---------- 计时 ----------
/** 请求并读完响应：返回首字节时间、总时间；firstEvent 为 SSE 里第一条正文的时间，doneEvent 为收到结束标记的时间 */
async function timed(path, { method = "GET", body, headers = {}, textMarker, doneMarker } = {}) {
  const t0 = performance.now();
  const r = await fetch(APP + path, {
    method,
    redirect: "manual",
    headers: { cookie, ...headers, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const headersAt = performance.now() - t0;
  const firstByteWall = Date.now();
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let firstByte;
  let firstText;
  let done;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    if (firstByte == null) firstByte = performance.now() - t0;
    buf += dec.decode(value, { stream: true });
    if (textMarker && firstText == null && buf.includes(textMarker)) firstText = performance.now() - t0;
    if (doneMarker && done == null && buf.includes(doneMarker)) done = performance.now() - t0;
  }
  const total = performance.now() - t0;
  return { status: r.status, headersAt, firstByte: firstByte ?? total, firstText, done, total, firstByteWall, body: buf };
}

const median = (a) => {
  const s = a.filter((x) => x != null).sort((x, y) => x - y);
  if (!s.length) return null;
  return Math.round(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  const r = await ui("/api/auth/login", { method: "POST", body: { password: PW } });
  if (r.status !== 200) throw new Error("登录失败 " + JSON.stringify(r));
}

// ---------- setup ----------
async function setup() {
  let r = await ui("/api/auth/setup", { method: "POST", body: { password: PW } });
  if (r.status !== 200) throw new Error("设密码失败 " + JSON.stringify(r));
  r = await ui("/api/channels", { method: "POST", body: { type: "openai", baseUrl: `${MOCK}/oa`, key: "sk-bench-1", name: "模拟 OpenAI" } });
  const ch = r.body.channel;
  await ui(`/api/channels/${ch.id}/models`, { method: "POST" });
  await ui(`/api/channels/${ch.id}`, { method: "PATCH", body: { models: ["gpt-4o", "gpt-4o-mini", "gpt-image-1"] } });
  await ui("/api/onboarding", { method: "PUT", body: { completed: true } });
  const convIds = [];
  for (let i = 0; i < 40; i++) {
    const id = "bench" + String(i).padStart(3, "0");
    const messages = [];
    for (let k = 0; k < 6; k++) {
      messages.push({ id: `u${k}`, role: "user", text: `第 ${i} 个对话的第 ${k} 个问题：怎么写一个快速排序？`, createdAt: Date.now() });
      messages.push({ id: `a${k}`, role: "assistant", text: "当然！\n\n```js\nfunction qs(a){if(a.length<2)return a;const [p,...r]=a;return [...qs(r.filter(x=>x<p)),p,...qs(r.filter(x=>x>=p))]}\n```\n\n- 先选基准\n- 再分区\n\n| 复杂度 | 值 |\n|---|---|\n| 平均 | O(n log n) |", model: "gpt-4o", createdAt: Date.now() });
    }
    await ui(`/api/conversations/${id}`, { method: "PUT", body: { title: `测试对话 ${i}`, model: "gpt-4o", messages, createdAt: Date.now() } });
    convIds.push(id);
  }
  for (let i = 0; i < 4; i++) await ui("/api/images", { method: "POST", body: { model: "gpt-image-1", prompt: `樱花舞台 ${i}`, n: 2, convId: convIds[0] } });
  for (let i = 0; i < 20; i++) await chatOnce();
  await sleep(500);
  const gallery = (await ui("/api/gallery")).body.items;
  const token = (await ui("/api/token")).body.token;
  fs.writeFileSync(STATE, JSON.stringify({ convId: convIds[5], image: gallery[0]?.url, token }));
  console.log("setup 完成：", convIds.length, "个对话，", gallery.length, "张图");
}

const chatBody = (txt = "你好") => ({ model: "gpt-4o", messages: [{ id: "u1", role: "user", text: txt, createdAt: 1 }] });
async function chatOnce() {
  return timed("/api/chat", { method: "POST", body: chatBody(), textMarker: "event: text", doneMarker: "event: done" });
}

// ---------- 场景 ----------
function scenarios(st) {
  const conv = st.convId;
  return [
    { name: "打开首页 HTML（GET /）", run: () => timed("/") },
    { name: "切换页面（RSC GET /channels）", run: () => timed("/channels", { headers: { RSC: "1", "Next-Router-State-Tree": encodeURIComponent(JSON.stringify(["", { children: ["(app)", { children: ["__PAGE__", {}] }] }, null, null, true])) } }) },
    { name: "启动数据 GET /api/bootstrap", run: () => timed("/api/bootstrap") },
    { name: "会话列表 GET /api/conversations", run: () => timed("/api/conversations") },
    { name: "打开对话 GET /api/conversations/:id", run: () => timed(`/api/conversations/${conv}`) },
    {
      name: "保存对话 PUT /api/conversations/:id",
      run: () => timed(`/api/conversations/benchsave`, { method: "PUT", body: { title: "保存测试", model: "gpt-4o", messages: chatBody().messages, createdAt: 1 } }),
    },
    { name: "图库 GET /api/gallery", run: () => timed("/api/gallery") },
    { name: "日志 GET /api/logs", run: () => timed("/api/logs") },
    { name: "设置 PUT /api/settings", run: () => timed("/api/settings", { method: "PUT", body: { temperature: 0.7 } }) },
    { name: "聊天 POST /api/chat（流式）", chat: true, run: () => chatOnce() },
    {
      name: "对外 POST /v1/chat/completions（流式）",
      chat: true,
      run: () =>
        timed("/v1/chat/completions", {
          method: "POST",
          headers: { authorization: "Bearer " + st.token },
          body: { model: "gpt-4o", stream: true, messages: [{ role: "user", content: "你好" }] },
          textMarker: '"content"',
          doneMarker: "[DONE]",
        }),
    },
    {
      name: "对外 POST /v1/chat/completions（非流式）",
      run: () =>
        timed("/v1/chat/completions", {
          method: "POST",
          headers: { authorization: "Bearer " + st.token },
          body: { model: "gpt-4o", messages: [{ role: "user", content: "你好" }] },
        }),
    },
    { name: "对外 GET /v1/models", run: () => timed("/v1/models", { headers: { authorization: "Bearer " + st.token } }) },
    ...(st.image ? [{ name: "图片 GET /api/files/:id", run: () => timed(st.image) }] : []),
  ];
}

async function run(out) {
  const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
  await login();
  const results = [];
  for (const sc of scenarios(st)) {
    // 先热身一次（编译、连接池）
    await sc.run();
    await sleep(150);
    const times = [];
    let q = null;
    for (let i = 0; i < RUNS; i++) {
      const counting = i === RUNS - 1;
      if (counting) await logReset();
      const r = await sc.run();
      if (r.status >= 400) console.log("  ! ", sc.name, r.status, r.body.slice(0, 200));
      times.push(r);
      if (counting) {
        await sleep(400); // 等后台写入也落库，一并计数
        q = await logCount(r.firstByteWall);
      }
      await sleep(60);
    }
    const row = {
      name: sc.name,
      firstByte: median(times.map((t) => t.firstByte)),
      total: median(times.map((t) => t.total)),
      firstText: sc.chat ? median(times.map((t) => t.firstText)) : undefined,
      done: sc.chat ? median(times.map((t) => t.done)) : undefined,
      queries: q.queries,
      beforeFirstByte: q.beforeFirstByte,
      connects: q.connects,
      sql: q.sql,
    };
    results.push(row);
    console.log(
      `${row.name.padEnd(40)} 首字节 ${String(row.firstByte).padStart(5)}ms  总 ${String(row.total).padStart(5)}ms` +
        (sc.chat ? `  首字 ${row.firstText}ms  done ${row.done}ms` : "") +
        `  查询 ${row.queries}（响应前 ${row.beforeFirstByte}）`,
    );
  }
  if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
  await logOff();
}

async function cold(out) {
  // 服务刚启动：登录后打开首页再拉启动数据和会话列表（等于浏览器第一次打开网站）
  await logReset();
  const t0 = performance.now();
  await login();
  const tLogin = performance.now() - t0;
  const page = await timed("/");
  const [b, c] = await Promise.all([timed("/api/bootstrap"), timed("/api/conversations")]);
  const total = performance.now() - t0;
  await sleep(400);
  const q = await logCount();
  const row = { login: Math.round(tLogin), page: Math.round(page.total), bootstrap: Math.round(b.total), conversations: Math.round(c.total), total: Math.round(total), queries: q.queries, connects: q.connects, sql: q.sql };
  console.log(JSON.stringify(row, null, 1));
  if (out) fs.writeFileSync(out, JSON.stringify(row, null, 2));
  await logOff();
}

const mode = process.argv[2];
if (mode === "setup") await setup();
else if (mode === "cold") await cold(process.argv[3]);
else await run(process.argv[3]);
process.exit(0);
