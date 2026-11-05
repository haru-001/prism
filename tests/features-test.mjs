// Prism 新功能测试（用量统计、令牌分权限、日志详情与重放、备份恢复、聊天增强）
// 需要先启动 mock.mjs 和 next start（端口 3100，空数据库或空的 .data）
const APP = process.env.APP || "http://127.0.0.1:3100";
const MOCK = process.env.MOCK || "http://127.0.0.1:9100";
let cookie = "";
let pass = 0;
let fail = 0;
const failures = [];

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

async function ui(path, { method = "GET", body } = {}) {
  const r = await fetch(APP + path, {
    method,
    redirect: "manual",
    headers: { cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
  return { status: r.status, body: j, headers: r.headers };
}

async function ext(path, { method = "POST", body, headers = {} } = {}) {
  const r = await fetch(APP + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return r;
}

async function readSSE(r) {
  const t = await r.text();
  const events = [];
  for (const block of t.split(/\n\n/)) {
    let ev = null;
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) ev = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (data.length) {
      const d = data.join("\n");
      let parsed = d;
      try {
        parsed = JSON.parse(d);
      } catch {}
      events.push({ event: ev, data: parsed });
    }
  }
  return { raw: t, events };
}

const mockLog = async () => (await fetch(MOCK + "/_log")).json();
const mockReset = () => fetch(MOCK + "/_reset");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const oa = (token, model, extra = {}) =>
  ext("/v1/chat/completions", { headers: { authorization: "Bearer " + token }, body: { model, messages: [{ role: "user", content: "你好" }], ...extra } });
const cl = (token, model, extra = {}) =>
  ext("/v1/messages", { headers: { "x-api-key": token, "anthropic-version": "2023-06-01" }, body: { model, max_tokens: 64, messages: [{ role: "user", content: "你好" }], ...extra } });
const gm = (token, model) => ext(`/v1beta/models/${model}:generateContent`, { headers: { "x-goog-api-key": token }, body: { contents: [{ role: "user", parts: [{ text: "你好" }] }] } });
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
// 网页聊天的 SSE：把 text 事件拼回完整回答
const uiText = (sse) =>
  String(sse)
    .split("\n\n")
    .filter((b) => b.startsWith("event: text"))
    .map((b) => JSON.parse(b.split("\ndata: ")[1]).t)
    .join("");
const near = (a, b) => Math.abs(a - b) < 1e-9;

// 和服务端一样的备份格式：测试里独立解开 / 重新封装，确认格式和加密是对的
import crypto from "node:crypto";
import zlib from "node:zlib";
function openFile(text, pw) {
  const env = JSON.parse(text);
  const key = crypto.scryptSync(pw, Buffer.from(env.kdf.salt, "base64"), 32, { N: env.kdf.N, r: env.kdf.r, p: env.kdf.p, maxmem: 64 * 1024 * 1024 });
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
  d.setAuthTag(Buffer.from(env.tag, "base64"));
  return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(Buffer.from(env.data, "base64")), d.final()])).toString());
}
function sealFile(data, pw) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(data)))), c.final()]);
  return JSON.stringify({ format: "prism-backup", version: 1, createdAt: data.createdAt, kdf: { name: "scrypt", N: 16384, r: 8, p: 1, salt: salt.toString("base64") }, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: ct.toString("base64") });
}
async function exportBackup(password, sections) {
  const r = await fetch(APP + "/api/backup/export", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ password, sections }) });
  return { status: r.status, text: await r.text(), headers: r.headers };
}

async function main() {
  console.log("\n[0] 准备：设密码、加渠道");
  let r = await ui("/api/auth/setup", { method: "POST", body: { password: "test1234" } });
  check("设密码并登录", r.status === 200 && cookie, r);
  const mk = async (body) => (await ui("/api/channels", { method: "POST", body })).body.channel;
  const OA = await mk({ type: "openai", baseUrl: `${MOCK}/oa`, key: "sk-oa-123456", name: "模拟 OpenAI" });
  const CL = await mk({ type: "anthropic", baseUrl: `${MOCK}/cl`, key: "sk-ant-123456", name: "模拟 Claude" });
  await ui(`/api/channels/${OA.id}`, { method: "PATCH", body: { models: ["gpt-4o", "gpt-4o-mini", "gpt-image-1"] } });
  await ui(`/api/channels/${CL.id}`, { method: "PATCH", body: { models: ["claude-sonnet-4-5"] } });
  await ui("/api/onboarding", { method: "PUT", body: { completed: true } });
  const DEF = (await ui("/api/token")).body.token;
  check("拿到默认令牌", typeof DEF === "string" && DEF.length > 10, DEF);

  // ================= 1. 用量与花费 =================
  console.log("\n[1] 用量和花费统计");
  r = await ui("/api/pricing", { method: "PUT", body: { pricing: { currency: "$", rules: [{ pattern: "gpt-4o*", input: 2.5, output: 10 }, { pattern: "gpt-image-1", input: 0, output: 0, perRequest: 0.04 }] } } });
  check("保存模型单价", r.status === 200 && r.body.pricing?.rules?.length === 2, r.body);
  r = await ui("/api/pricing", { method: "PUT", body: { pricing: { currency: "$", rules: [{ pattern: "", input: 1 }] } } });
  check("空模型名的单价规则被丢掉", r.status === 200 && r.body.pricing.rules.length === 0, r.body);
  await ui("/api/pricing", { method: "PUT", body: { pricing: { currency: "$", rules: [{ pattern: "gpt-4o*", input: 2.5, output: 10 }, { pattern: "gpt-image-1", input: 0, output: 0, perRequest: 0.04 }] } } });

  for (let i = 0; i < 2; i++) check(`OpenAI 格式调用 gpt-4o 第 ${i + 1} 次`, (await oa(DEF, "gpt-4o")).status === 200);
  r = await cl(DEF, "claude-sonnet-4-5", { stream: true });
  await r.text();
  check("Claude 流式调用", r.status === 200);
  r = await ext("/v1/images/generations", { headers: { authorization: "Bearer " + DEF }, body: { model: "gpt-image-1", prompt: "一只猫", n: 1 } });
  check("生图调用", r.status === 200, await r.clone().text().catch(() => ""));
  await r.text().catch(() => {});
  r = await ui("/api/chat", { method: "POST", body: { model: "gpt-4o-mini", messages: [{ id: "u1", role: "user", text: "网页聊天", createdAt: Date.now() }] } });
  check("网页聊天调用", r.status === 200);

  r = await ui("/api/usage?days=7");
  const U = r.body;
  check("报表返回 7 天的每日数据", r.status === 200 && U.days?.length === 7, U?.days?.length);
  const today = U.days?.[U.days.length - 1];
  check("今天这一天有 5 次请求", today?.requests === 5, today);
  const g4 = U.models?.find((m) => m.key === "gpt-4o");
  check("gpt-4o：2 次请求，输入 22 / 输出 14 tokens", g4?.requests === 2 && g4.inTok === 22 && g4.outTok === 14, g4);
  check("gpt-4o 花费按单价估算 = 0.000195", g4 && near(g4.cost, (2 * (11 * 2.5 + 7 * 10)) / 1e6), g4?.cost);
  const img = U.models?.find((m) => m.key === "gpt-image-1");
  check("生图按每次 0.04 计费", img && near(img.cost, 0.04), img);
  check("没填单价的模型被列出来（claude-sonnet-4-5）", U.unpriced?.includes("claude-sonnet-4-5"), U.unpriced);
  check("按渠道统计", U.channels?.some((c) => c.key === "模拟 OpenAI" && c.requests === 4) && U.channels.some((c) => c.key === "模拟 Claude"), U.channels);
  check("按令牌统计：默认令牌 4 次、网页 1 次", U.tokens?.find((t) => t.key === "default")?.requests === 4 && U.tokens.find((t) => t.key === "web")?.requests === 1, U.tokens);
  check("令牌有中文名字", U.tokenNames?.default && U.tokenNames.web, U.tokenNames);
  check("合计", U.total?.requests === 5 && near(U.total.cost, g4.cost + img.cost + (U.models.find((m) => m.key === "gpt-4o-mini")?.cost || 0)), U.total);

  await ui("/api/pricing", { method: "PUT", body: { pricing: { currency: "¥", rules: [{ pattern: "gpt-4o", input: 25, output: 100 }, { pattern: "gpt-image-1", perRequest: 0.3 }] } } });
  r = await ui("/api/usage?days=7");
  const g4b = r.body.models.find((m) => m.key === "gpt-4o");
  check("改单价后历史花费按新单价重算", near(g4b.cost, (2 * (11 * 25 + 7 * 100)) / 1e6) && r.body.currency === "¥", g4b);
  r = await ui("/api/usage?days=9999");
  check("天数超范围被限制（最多 90 天）", r.status === 200 && r.body.days.length <= 90, r.body.days?.length);
  r = await ui("/api/usage?days=30");
  check("30 天报表", r.body.days.length === 30 && r.body.total.requests === 5, r.body.days.length);
  r = await ui("/usage");
  check("用量页面返回 200", r.status === 200, r.status);

  // ================= 2. 令牌分权限 =================
  console.log("\n[2] 令牌分权限");
  r = await ui("/api/tokens");
  const def = r.body.tokens?.find((t) => t.id === "default");
  check("令牌列表里有默认令牌，且不受限制", def && def.key === DEF && def.enabled && !def.models?.length && !def.quota && !def.expiresAt, def);
  check("默认令牌显示已用量", def?.used?.tokens > 0, def?.used);

  r = await ui("/api/tokens", { method: "POST", body: { name: "受限令牌", models: ["gpt-4o-mini", "claude*"], quota: { kind: "tokens", limit: 30 }, expiresAt: Date.now() + 86400e3 } });
  const T1 = r.body.token;
  check("新建受限令牌", r.status === 200 && T1?.key?.startsWith("sk-") && T1.models.length === 2 && T1.quota?.limit === 30, r.body);
  r = await ui("/api/tokens", { method: "POST", body: { name: "" } });
  check("令牌名字为空时自动起名或被拒", r.status === 400 || (r.status === 200 && r.body.token?.name), r.body);
  if (r.status === 200) await ui(`/api/tokens/${r.body.token.id}`, { method: "DELETE" });
  r = await ui("/api/tokens", { method: "POST", body: { name: "坏额度", quota: { kind: "tokens", limit: -5 } } });
  check("负数额度被拒或被忽略", r.status === 400 || !r.body.token?.quota, r.body);
  if (r.status === 200) await ui(`/api/tokens/${r.body.token.id}`, { method: "DELETE" });

  let x = await j(await oa(T1.key, "gpt-4o"));
  check("不允许的模型（OpenAI 格式）→ 403 permission_error", x.status === 403 && x.body?.error?.type === "permission_error" && /不能使用模型 gpt-4o/.test(x.body.error.message), x);
  x = await j(await cl(T1.key, "gpt-4o"));
  check("不允许的模型（Claude 格式）→ 403 + Claude 错误结构", x.status === 403 && x.body?.type === "error" && x.body.error?.type === "permission_error", x);
  x = await j(await gm(T1.key, "gemini-2.5-flash"));
  check("不允许的模型（Gemini 格式）→ 403 PERMISSION_DENIED", x.status === 403 && x.body?.error?.status === "PERMISSION_DENIED", x);
  x = await j(await ext("/v1/images/generations", { headers: { authorization: "Bearer " + T1.key }, body: { model: "gpt-image-1", prompt: "x" } }));
  check("不允许的生图模型 → 403", x.status === 403, x);
  r = await fetch(APP + "/v1/models", { headers: { authorization: "Bearer " + T1.key } });
  x = await r.json();
  const ids = x.data?.map((m) => m.id).sort();
  check("/v1/models 只列出这个令牌能用的模型", JSON.stringify(ids) === JSON.stringify(["claude-sonnet-4-5", "gpt-4o-mini"]), ids);

  check("允许的模型能用（第 1 次，18 tokens）", (await oa(T1.key, "gpt-4o-mini")).status === 200);
  x = await j(await cl(T1.key, "claude-sonnet-4-5"));
  check("通配 claude* 能用（第 2 次）", x.status === 200, x);
  x = await j(await oa(T1.key, "gpt-4o-mini"));
  check("额度用完（OpenAI 格式）→ 429 insufficient_quota", x.status === 429 && x.body?.error?.type === "insufficient_quota" && /额度已用完/.test(x.body.error.message), x);
  x = await j(await cl(T1.key, "claude-sonnet-4-5"));
  check("额度用完（Claude 格式）→ 429 rate_limit_error", x.status === 429 && x.body?.error?.type === "rate_limit_error", x);
  x = await j(await gm(T1.key, "gpt-4o-mini"));
  check("额度用完（Gemini 格式）→ 429 RESOURCE_EXHAUSTED", x.status === 429 && x.body?.error?.status === "RESOURCE_EXHAUSTED", x);
  x = await j(await oa(T1.key, "gpt-4o-mini", { stream: true }));
  check("流式请求超额也返回清楚的 429 JSON", x.status === 429 && x.body?.error?.message, x);
  r = await ui("/api/tokens");
  let t1 = r.body.tokens.find((t) => t.id === T1.id);
  check("令牌已用量统计正确（18 + 15 = 33 tokens）", t1.used.tokens === 33, t1.used);

  r = await ui(`/api/tokens/${T1.id}`, { method: "PATCH", body: { resetUsage: true } });
  check("额度清零", r.status === 200 && r.body.token.used.tokens === 0, r.body);
  check("清零后又能用", (await oa(T1.key, "gpt-4o-mini")).status === 200);
  r = await ui("/api/usage?days=7");
  check("清零不影响用量报表（历史还在）", r.body.tokens.filter((t) => t.key.startsWith(T1.id)).reduce((a, b) => a + b.requests, 0) >= 3, r.body.tokens);

  await ui(`/api/tokens/${T1.id}`, { method: "PATCH", body: { enabled: false } });
  x = await j(await oa(T1.key, "gpt-4o-mini"));
  check("停用后 → 401 authentication_error", x.status === 401 && x.body?.error?.type === "authentication_error" && /已停用/.test(x.body.error.message), x);
  x = await j(await cl(T1.key, "claude-sonnet-4-5"));
  check("停用后（Claude 格式）→ 401 authentication_error", x.status === 401 && x.body?.error?.type === "authentication_error", x);
  await ui(`/api/tokens/${T1.id}`, { method: "PATCH", body: { enabled: true, expiresAt: Date.now() - 1000 } });
  x = await j(await oa(T1.key, "gpt-4o-mini"));
  check("过期后 → 401，提示过期时间", x.status === 401 && /过期/.test(x.body?.error?.message), x);
  await ui(`/api/tokens/${T1.id}`, { method: "PATCH", body: { expiresAt: null } });
  check("取消过期时间后恢复", (await oa(T1.key, "gpt-4o-mini")).status === 200);

  r = await ui("/api/tokens", { method: "POST", body: { name: "按金额", quota: { kind: "cost", limit: 0.002 } } });
  const T2 = r.body.token;
  // 当前单价 gpt-4o 输入 25 / 输出 100 每百万：每次 (11*25+7*100)/1e6 = 0.000975
  check("按金额第 1 次", (await oa(T2.key, "gpt-4o")).status === 200);
  check("按金额第 2 次（0.000975 < 0.002）", (await oa(T2.key, "gpt-4o")).status === 200);
  check("按金额第 3 次（0.00195 < 0.002）", (await oa(T2.key, "gpt-4o")).status === 200);
  x = await j(await oa(T2.key, "gpt-4o"));
  check("金额额度用完 → 429，带货币符号", x.status === 429 && /¥/.test(x.body?.error?.message), x);

  await ui(`/api/tokens/${T1.id}`, { method: "PATCH", body: { resetUsage: true } });
  const oldKey = T1.key;
  r = await ui(`/api/tokens/${T1.id}`, { method: "PATCH", body: { resetKey: true } });
  const newKey = r.body.token?.key;
  check("换新 Key", newKey && newKey !== oldKey, r.body);
  check("旧 Key 失效", (await oa(oldKey, "gpt-4o-mini")).status === 401);
  check("新 Key 可用", (await oa(newKey, "gpt-4o-mini")).status === 200);
  r = await ui("/api/tokens/default", { method: "DELETE" });
  check("默认令牌不能删除", r.status === 400, r.body);
  r = await ui(`/api/tokens/${T2.id}`, { method: "DELETE" });
  check("删除令牌", r.status === 200);
  check("删除后的令牌不能用", (await oa(T2.key, "gpt-4o")).status === 401);
  check("默认令牌一直不受限制", (await oa(DEF, "gpt-4o")).status === 200 && (await gm(DEF, "gpt-4o")).status === 200);
  r = await ui("/api/logs");
  const lg = r.body.logs.find((l) => l.tokenName === "受限令牌");
  check("日志里记录了令牌名字", !!lg, r.body.logs.slice(0, 3));
  check("被拒的请求也记进日志", r.body.logs.some((l) => !l.ok && l.tokenName === "受限令牌" && /不能使用模型/.test(l.error || "")), null);

  // ================= 3. 日志详情和重放 =================
  console.log("\n[3] 日志详情和重放");
  await oa(DEF, "gpt-4o", { temperature: 0.3, user: "重放测试" });
  r = await ui("/api/logs");
  let logs = r.body.logs;
  const L1 = logs.find((l) => l.source === "openai" && l.ok && l.detail && l.model === "gpt-4o");
  check("日志带 detail 标记", !!L1, logs[0]);
  r = await ui(`/api/logs/${L1.id}`);
  const D = r.body.detail;
  check("详情接口返回请求和响应", r.status === 200 && D?.request?.path === "/v1/chat/completions" && D.response?.status === 200, r.body);
  check("请求体完整（含 model、temperature）", JSON.parse(D.request.body).temperature === 0.3 && JSON.parse(D.request.body).model === "gpt-4o", D.request.body);
  const auth = Object.entries(D.request.headers).find(([k]) => k.toLowerCase() === "authorization")?.[1] || "";
  check("Authorization 已打码", auth && !auth.includes(DEF), auth);
  check("响应体存了模型回答", D.response.body.includes("OA[gpt-4o]"), D.response.body.slice(0, 200));

  const before = logs.length;
  r = await ui(`/api/logs/${L1.id}/replay`, { method: "POST" });
  check("一键重放成功", r.status === 200 && r.body.result?.status === 200 && r.body.result.body.includes("OA[gpt-4o]"), r.body);
  r = await ui("/api/logs");
  const RP = r.body.logs[0];
  check("重放产生一条新日志，标明重放自哪条", r.body.logs.length === before + 1 && RP.replayOf === L1.id && RP.model === "gpt-4o", RP);

  r = await cl(DEF, "claude-sonnet-4-5", { stream: true });
  await r.text();
  logs = (await ui("/api/logs")).body.logs;
  const L2 = logs.find((l) => l.source === "claude" && l.stream && l.ok);
  r = await ui(`/api/logs/${L2.id}`);
  check("流式响应的详情存了 SSE 文本", r.body.detail?.response?.body?.includes("content_block_delta"), r.body.detail?.response?.body?.slice(0, 200));
  r = await ui(`/api/logs/${L2.id}/replay`, { method: "POST" });
  check("重放 Claude 流式请求", r.body.result?.status === 200 && r.body.result.body.includes("CL["), r.body);

  await ui("/api/chat", { method: "POST", body: { model: "gpt-4o-mini", messages: [{ id: "u1", role: "user", text: "网页重放", createdAt: Date.now() }] } });
  logs = (await ui("/api/logs")).body.logs;
  const L3 = logs.find((l) => l.source === "ui" && l.detail);
  r = await ui(`/api/logs/${L3.id}/replay`, { method: "POST" });
  check("重放网页聊天请求", r.body.result?.status === 200 && uiText(r.body.result.body).includes("网页重放"), r.body);

  const big = "长".repeat(5000);
  await oa(DEF, "gpt-4o", { messages: [{ role: "user", content: big }] });
  logs = (await ui("/api/logs")).body.logs;
  r = await ui(`/api/logs/${logs[0].id}`);
  check("超长请求被截断并标记", r.body.detail?.truncated === true && r.body.detail.request.body.length < big.length * 3, r.body.detail?.truncated);
  r = await ui(`/api/logs/${logs[0].id}/replay`, { method: "POST" });
  check("截断过的请求不能重放，给出原因", r.status === 400 && /截断/.test(r.body.error), r.body);
  r = await ui("/api/logs/nope/replay", { method: "POST" });
  check("不存在的日志重放 → 404", r.status === 404, r.body);
  r = await fetch(APP + `/api/logs/${L1.id}`);
  check("未登录不能看详情", r.status === 401);

  // ================= 4. 聊天增强（预设、并排、识图、导出） =================
  console.log("\n[4] 聊天增强");
  r = await ui("/api/presets", { method: "PUT", body: { presets: [{ id: "p1", name: "翻译官", system: "你是一位专业翻译，把输入翻成英文。", temperature: 0.2 }, { id: "p2", name: "代码助手", system: "你是资深工程师。" }, { name: "", system: "x" }] } });
  check("保存提示词预设（空名字的被丢掉）", r.status === 200 && r.body.presets?.length === 2, r.body);
  r = await ui("/api/presets");
  check("读取预设", r.body.presets?.[0]?.name === "翻译官" && r.body.presets[0].temperature === 0.2, r.body);
  r = await ui("/");
  check("首页启动数据里带预设（新建会话时能直接选）", typeof r.body === "string" && r.body.includes("翻译官"), null);

  await mockReset();
  r = await ui("/api/chat", {
    method: "POST",
    body: {
      model: "gpt-4o-mini",
      system: "你是一位专业翻译，把输入翻成英文。",
      messages: [
        { id: "u1", role: "user", text: "第一问", createdAt: 1 },
        { id: "a1", role: "assistant", text: "选用的回答", group: "g1", createdAt: 2 },
        { id: "a2", role: "assistant", text: "没选用的回答", group: "g1", alt: true, createdAt: 3 },
        { id: "u2", role: "user", text: "看看这张图", images: ["data:image/png;base64,iVBORw0KGgo="], createdAt: 4 },
      ],
    },
  });
  await r;
  const sent = (await mockLog()).find((l) => l.path.includes("chat/completions"))?.body;
  const sentText = JSON.stringify(sent?.messages || []);
  check("并排对比：选用的回答进入后续上下文", sentText.includes("选用的回答"), sent?.messages);
  check("并排对比：没选用的回答不进入上下文", !sentText.includes("没选用的回答"), sent?.messages);
  check("预设的系统提示词发给了模型", sent?.messages?.[0]?.role === "system" && sent.messages[0].content.includes("专业翻译"), sent?.messages?.[0]);
  const lastUser = sent?.messages?.[sent.messages.length - 1];
  check("识图：图片按 image_url 发给模型", Array.isArray(lastUser?.content) && lastUser.content.some((c) => c.type === "image_url"), lastUser);

  // 并排：两个模型同时回答同一个问题
  const q = [{ id: "u1", role: "user", text: "同一个问题", createdAt: 1 }];
  const [ra, rb] = await Promise.all([
    ui("/api/chat", { method: "POST", body: { model: "gpt-4o-mini", messages: q } }),
    ui("/api/chat", { method: "POST", body: { model: "claude-sonnet-4-5", messages: q } }),
  ]);
  check("并排：两个模型同时回答", ra.status === 200 && rb.status === 200 && uiText(ra.body).includes("OA[gpt-4o-mini]") && uiText(rb.body).includes("CL[claude-sonnet-4-5]"), [uiText(ra.body), uiText(rb.body)]);

  const conv = {
    id: "convexp1",
    title: "导出/测试：对比",
    model: "gpt-4o-mini",
    system: "你是一位专业翻译。",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [
      { id: "u1", role: "user", text: "你好 👋", createdAt: 1, images: ["/api/files/abc.png"] },
      { id: "a1", role: "assistant", text: "**你好**呀", model: "gpt-4o-mini", channel: "模拟 OpenAI", group: "g1", createdAt: 2 },
      { id: "a2", role: "assistant", text: "Hello", model: "claude-sonnet-4-5", channel: "模拟 Claude", group: "g1", alt: true, createdAt: 3 },
      { id: "n1", role: "notice", text: "线路切换了一次", createdAt: 4 },
    ],
  };
  r = await ui(`/api/conversations/${conv.id}`, { method: "PUT", body: conv });
  check("保存一个带并排回答的对话", r.status === 200, r.body);
  let res = await fetch(APP + `/api/conversations/${conv.id}/export?format=md`, { headers: { cookie } });
  const md = await res.text();
  check("导出 Markdown：类型和文件名", res.headers.get("content-type")?.includes("text/markdown") && /filename\*=UTF-8''/.test(res.headers.get("content-disposition") || ""), res.headers.get("content-disposition"));
  check("Markdown 含标题、系统提示词、双方发言", md.startsWith("# 导出/测试：对比") && md.includes("你是一位专业翻译") && md.includes("## 你") && md.includes("**你好**呀"), md.slice(0, 300));
  check("Markdown 标出并排回答和选用的那个", md.includes("gpt-4o-mini · 模拟 OpenAI（并排回答 · 已选用）") && md.includes("claude-sonnet-4-5 · 模拟 Claude（并排回答）"), md);
  check("Markdown 里站内图片补成完整链接（带签名，不登录也能打开）", /!\[\]\(http:\/\/[^)]+\/api\/files\/abc\.png\?s=[\w-]{22}\)/.test(md), md);
  res = await fetch(APP + `/api/conversations/${conv.id}/export?format=json`, { headers: { cookie } });
  const js = await res.json();
  check("导出 JSON：结构完整", js.format === "prism-conversation" && js.title === conv.title && js.messages.length === 4 && js.system === conv.system, js);
  check("JSON 标出选用哪个回答", js.messages[1].chosen === true && js.messages[2].chosen === false && js.messages[0].text === "你好 👋", js.messages);
  r = await fetch(APP + `/api/conversations/${conv.id}/export?format=md`);
  check("未登录不能导出", r.status === 401);
  r = await ui(`/api/conversations/nope/export`);
  check("不存在的对话导出 → 404", r.status === 404);

  // ================= 5. 备份与恢复 =================
  console.log("\n[5] 备份和恢复");
  await ui("/api/settings", { method: "PUT", body: { callMode: "producer" } });
  let b = await exportBackup("123", ["channels"]);
  check("备份密码太短被拒", b.status === 400);
  b = await exportBackup("backup-pass", []);
  check("没选内容被拒", b.status === 400);
  b = await exportBackup("backup-pass", ["channels", "settings", "tokens", "conversations"]);
  const FILE = b.text;
  check("导出备份文件", b.status === 200 && /attachment; filename="prism-backup-\d{8}-\d{4}\.prismbak"/.test(b.headers.get("content-disposition") || ""), b.headers.get("content-disposition"));
  check("备份文件是加密的（看不到渠道名、Key、对话）", !FILE.includes("模拟 OpenAI") && !FILE.includes("sk-oa-123456") && !FILE.includes(newKey) && !FILE.includes("导出/测试") && JSON.parse(FILE).format === "prism-backup", FILE.slice(0, 200));
  const inner = openFile(FILE, "backup-pass");
  check("解开后包含 4 类内容", inner.channels.length === 2 && inner.tokens.length >= 2 && inner.conversations.some((c) => c.id === conv.id) && inner.settings.presets.length === 2 && inner.settings.pricing.currency === "¥", Object.keys(inner));
  check("上游 Key 在备份里仍是加密的", inner.channels.every((c) => c.keyEnc && !c.keyEnc.includes("sk-")) && !JSON.stringify(inner).includes("sk-oa-123456"), inner.channels[0]);

  r = await ui("/api/backup/preview", { method: "POST", body: { file: FILE, password: "wrong-pass" } });
  check("密码错误 → 清楚的报错", r.status === 400 && /密码不对/.test(r.body.error), r.body);
  r = await ui("/api/backup/preview", { method: "POST", body: { file: "{\"hello\":1}", password: "backup-pass" } });
  check("不是备份文件 → 报错", r.status === 400 && /不是 Prism 的备份文件/.test(r.body.error), r.body);

  // 备份之后改动一些东西
  await ui(`/api/channels/${OA.id}`, { method: "PATCH", body: { name: "改过名的 OpenAI" } });
  const NEW = await mk({ type: "openai", baseUrl: `${MOCK}/oa`, key: "sk-new-999999", name: "备份后新加的" });
  await ui(`/api/conversations/${conv.id}`, { method: "DELETE" });
  await ui("/api/settings", { method: "PUT", body: { callMode: "you" } });
  await ui("/api/presets", { method: "PUT", body: { presets: [] } });
  await ui(`/api/tokens/${T1.id}`, { method: "DELETE" });

  r = await ui("/api/backup/preview", { method: "POST", body: { file: FILE, password: "backup-pass" } });
  const P = r.body.preview?.detail;
  check("预览成功，列出 4 类", r.status === 200 && r.body.preview.sections.length === 4, r.body);
  check("预览：渠道会覆盖「模拟 OpenAI」「模拟 Claude」，保留 1 个", P?.channels?.overwrite?.includes("模拟 OpenAI") && P.channels.overwrite.length === 2 && P.channels.keep === 1 && P.channels.add.length === 0, P?.channels);
  check("预览：Key 都能解开", P?.channels?.keyProblems?.length === 0, P?.channels);
  check("预览：设置里称呼方式会改动", P?.settings?.changes?.some((c) => c.label === "称呼方式"), P?.settings);
  check("预览：预设会新增 2 个", P?.settings?.presets?.add?.length === 2, P?.settings?.presets);
  check("预览：令牌会新增被删掉的那个", P?.tokens?.add?.includes("受限令牌"), P?.tokens);
  check("预览：会话会新增 1 个（被删掉的）", P?.conversations?.add === 1 && P.conversations.addSample.includes("导出/测试：对比"), P?.conversations);
  r = await ui("/api/channels");
  check("预览不改动任何数据", r.body.channels.some((c) => c.name === "改过名的 OpenAI"), null);

  r = await ui("/api/backup/restore", { method: "POST", body: { file: FILE, password: "backup-pass", sections: ["settings"] } });
  check("只恢复「设置」", r.status === 200 && r.body.restored?.settings === 1 && !r.body.restored.channels, r.body);
  r = await ui("/api/channels");
  check("只恢复设置时渠道不动", r.body.channels.some((c) => c.name === "改过名的 OpenAI"), null);
  r = await ui("/api/presets");
  check("预设恢复了", r.body.presets.length === 2, r.body);

  r = await ui("/api/backup/restore", { method: "POST", body: { file: FILE, password: "backup-pass", sections: ["channels", "tokens", "conversations"] } });
  check("恢复渠道、令牌、会话", r.status === 200 && r.body.restored?.channels === 2 && r.body.restored.conversations >= 1, r.body);
  r = await ui("/api/channels");
  check("渠道名字恢复，备份后新加的保留", r.body.channels.some((c) => c.name === "模拟 OpenAI") && r.body.channels.some((c) => c.id === NEW.id), r.body.channels.map((c) => c.name));
  r = await ui(`/api/conversations/${conv.id}`);
  check("删掉的会话恢复了，内容一致", r.body.conversation?.messages?.length === 4 && r.body.conversation.messages[0].text === "你好 👋", r.body);
  r = await ui("/api/conversations");
  check("会话出现在左栏列表里", r.body.conversations.some((c) => c.id === conv.id), null);
  x = await j(await oa(newKey, "gpt-4o-mini"));
  check("恢复的令牌又能用了（限制也还在）", x.status === 200 && (await oa(newKey, "gpt-4o")).status === 403, x);
  await mockReset();
  x = await j(await oa(DEF, "gpt-4o"));
  const up = (await mockLog()).find((l) => l.path.includes("chat/completions"));
  check("恢复后的上游 Key 能正常解开使用", x.status === 200 && up?.auth === "Bearer sk-oa-123456", up);
  r = await ui("/api/settings");
  check("设置恢复了（称呼方式）", r.body.settings?.callMode === "producer", r.body.settings);

  // 换了 PRISM_SECRET 的情况：Key 解不开时预览要提醒
  const bad = { ...inner, channels: inner.channels.map((c) => ({ ...c, keyEnc: "v1:AAAA:BBBB:CCCC" })) };
  r = await ui("/api/backup/preview", { method: "POST", body: { file: sealFile(bad, "backup-pass"), password: "backup-pass" } });
  check("Key 解不开时预览列出受影响的渠道", r.body.preview?.detail?.channels?.keyProblems?.length === 2, r.body.preview?.detail?.channels);
  r = await ui("/api/backup/preview", { method: "POST", body: { file: FILE.replace(/"data":"(.{10})/, '"data":"AAAAAAAAAA'), password: "backup-pass" } });
  check("文件被改坏 → 报错", r.status === 400, r.body);

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail) {
    console.log("失败项：\n - " + failures.join("\n - "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
