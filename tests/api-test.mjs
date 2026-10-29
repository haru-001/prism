// Prism 接口测试：需要先启动 mock.mjs 和 next start（端口 3100，空的 .data）
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

// ---------- 各入口格式的请求和解析 ----------
const PROMPT = "你好 prism";

const inbound = {
  openai: {
    async call(model, stream, token) {
      const r = await ext("/v1/chat/completions", {
        headers: { authorization: "Bearer " + token },
        body: { model, stream, messages: [{ role: "system", content: "be nice" }, { role: "user", content: PROMPT }], extra_passthrough_field: 42 },
      });
      if (!stream) {
        const j = await r.json();
        return { status: r.status, text: j.choices?.[0]?.message?.content, usage: j.usage, raw: j };
      }
      const { events, raw } = await readSSE(r);
      const text = events
        .filter((e) => e.data && typeof e.data === "object")
        .map((e) => e.data.choices?.[0]?.delta?.content || "")
        .join("");
      const done = events.some((e) => e.data === "[DONE]");
      return { status: r.status, text, done, chunks: events.length, raw: raw.slice(0, 400), ctype: r.headers.get("content-type") };
    },
  },
  claude: {
    async call(model, stream, token) {
      const r = await ext("/v1/messages", {
        headers: { "x-api-key": token, "anthropic-version": "2023-06-01" },
        body: { model, stream, max_tokens: 256, system: "be nice", messages: [{ role: "user", content: PROMPT }] },
      });
      if (!stream) {
        const j = await r.json();
        return { status: r.status, text: j.content?.map((c) => c.text).join(""), usage: j.usage, raw: j };
      }
      const { events, raw } = await readSSE(r);
      const text = events
        .filter((e) => e.event === "content_block_delta")
        .map((e) => e.data.delta?.text || "")
        .join("");
      const done = events.some((e) => e.event === "message_stop");
      return { status: r.status, text, done, chunks: events.length, raw: raw.slice(0, 400), ctype: r.headers.get("content-type") };
    },
  },
  gemini: {
    async call(model, stream, token) {
      const path = `/v1beta/models/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
      const r = await ext(path, {
        headers: { "x-goog-api-key": token },
        body: { systemInstruction: { parts: [{ text: "be nice" }] }, contents: [{ role: "user", parts: [{ text: PROMPT }] }] },
      });
      if (!stream) {
        const j = await r.json();
        return { status: r.status, text: j.candidates?.[0]?.content?.parts?.map((p) => p.text).join(""), usage: j.usageMetadata, raw: j };
      }
      const { events, raw } = await readSSE(r);
      const text = events
        .filter((e) => e.data && typeof e.data === "object")
        .map((e) => e.data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "")
        .join("");
      const done = events.some((e) => e.data?.candidates?.[0]?.finishReason);
      return { status: r.status, text, done, chunks: events.length, raw: raw.slice(0, 400), ctype: r.headers.get("content-type") };
    },
  },
};

async function main() {
  console.log("\n[1] 未设密码时的跳转");
  let r = await ui("/");
  check("/ 跳到 /onboarding", r.status === 307 && r.headers.get("location")?.endsWith("/onboarding"), r.headers.get("location"));
  r = await ui("/login");
  check("/login 跳到 /onboarding", r.status === 307 && r.headers.get("location")?.endsWith("/onboarding"));
  r = await ui("/onboarding");
  check("/onboarding 正常打开", r.status === 200 && String(r.body).includes("设一个访问密码"));
  r = await ui("/api/channels");
  check("未登录访问后台接口被拒", r.status === 401, r.status);

  console.log("\n[2] 引导第 1 步：设密码");
  r = await ui("/api/auth/setup", { method: "POST", body: { password: "123" } });
  check("密码太短被拒", r.status === 400, r);
  r = await ui("/api/auth/setup", { method: "POST", body: { password: "test1234" } });
  check("设密码成功并登录", r.status === 200 && cookie, r);
  r = await ui("/");
  check("引导未完成时 / 跳 /onboarding", r.status === 307 && r.headers.get("location")?.endsWith("/onboarding"));

  console.log("\n[3] 引导第 2–3 步：加渠道、获取模型");
  const mk = async (body) => (await ui("/api/channels", { method: "POST", body })).body.channel;
  const OA = await mk({ type: "openai", baseUrl: `${MOCK}/oa`, key: "sk-oa-123456", priority: 2, name: "模拟 OpenAI" });
  const CL = await mk({ type: "anthropic", baseUrl: `${MOCK}/cl/v1/`, key: "sk-ant-123456", name: "模拟 Claude" });
  const GM = await mk({ type: "gemini", baseUrl: `${MOCK}/gm`, key: "AIza-gm-123456", name: "模拟 Gemini" });
  const BAD = await mk({ type: "compatible", baseUrl: `${MOCK}/bad`, key: "sk-bad-123456", priority: 1, name: "会失败的中转" });
  r = await ui("/api/channels", { method: "POST", body: { type: "bogus", baseUrl: "https://x.com", key: "k" } });
  check("不支持的渠道类型被拒绝", r.status === 400, r);
  check("创建 4 个渠道", OA?.id && CL?.id && GM?.id && BAD?.id, { OA, CL });
  check("Base URL 自动补 /v1", OA.endpoint === `${MOCK}/oa/v1`, OA.endpoint);
  check("Claude 地址带 /v1/ 也能识别", CL.endpoint === `${MOCK}/cl/v1`, CL.endpoint);
  check("Gemini 地址自动补 /v1beta", GM.endpoint === `${MOCK}/gm/v1beta`, GM.endpoint);
  check("Key 不会明文返回", !JSON.stringify(OA).includes("sk-oa-123456"), OA.keyHint);

  const fetched = {};
  for (const [n, c] of Object.entries({ OA, CL, GM, BAD })) {
    r = await ui(`/api/channels/${c.id}/models`, { method: "POST" });
    fetched[n] = r.body;
    check(`${n} 获取模型成功`, r.status === 200 && r.body.models?.length > 0, r.body);
  }
  check("OpenAI 常用模型自动勾选（含 gpt-4o，不含 embedding）", fetched.OA.popular.includes("gpt-4o") && !fetched.OA.popular.some((m) => m.includes("embedding")), fetched.OA.popular);
  check("Claude 模型列表正确", fetched.CL.models.includes("claude-sonnet-4-5"), fetched.CL.models);
  check("Gemini 去掉 models/ 前缀、过滤非对话模型", fetched.GM.models.includes("gemini-2.5-flash") && !fetched.GM.models.some((m) => m.startsWith("models/")), fetched.GM.models);

  await ui(`/api/channels/${OA.id}`, { method: "PATCH", body: { models: ["gpt-4o", "gpt-4o-mini", "gpt-image-1"] } });
  await ui(`/api/channels/${BAD.id}`, { method: "PATCH", body: { models: ["gpt-4o"] } });
  await ui(`/api/channels/${CL.id}`, { method: "PATCH", body: { models: ["claude-sonnet-4-5"] } });
  r = await ui(`/api/channels/${GM.id}`, { method: "PATCH", body: { models: ["gemini-2.5-flash"], mapping: { flash: "gemini-2.5-flash" } } });
  check("保存模型和别名", r.status === 200 && r.body.channel?.mapping?.flash === "gemini-2.5-flash", r.body);

  r = await ui("/api/channels/" + OA.id + "/test", { method: "POST", body: {} });
  check("测试延迟返回成功和毫秒数", r.body.ok === true && typeof r.body.latencyMs === "number", r.body);
  r = await ui("/api/channels/" + BAD.id + "/test", { method: "POST", body: {} });
  check("坏线路测试返回失败信息", r.body.ok === false && r.body.message, r.body);

  r = await ui("/api/onboarding", { method: "PUT", body: { completed: true } });
  check("引导进度存到后端", r.body.onboarding?.completed === true, r.body);
  for (const p of ["/", "/channels", "/tokens", "/logs", "/settings", "/gallery"]) {
    r = await ui(p);
    check(`页面 ${p} 返回 200`, r.status === 200, r.status);
  }
  r = await ui("/login");
  check("已登录时 /login 跳回首页", r.status === 307 && new URL(r.headers.get("location"), APP).pathname === "/", r.headers.get("location"));

  console.log("\n[4] 令牌与鉴权");
  r = await ui("/api/token");
  let token = r.body.token;
  check("读取访问令牌", typeof token === "string" && token.length > 16, r.body);
  let res = await ext("/v1/models", { method: "GET" });
  check("没带令牌访问 /v1/models 返回 401", res.status === 401, res.status);
  res = await ext("/v1/models", { method: "GET", headers: { authorization: "Bearer wrong" } });
  check("错误令牌返回 401", res.status === 401, res.status);
  res = await ext("/v1/models", { method: "GET", headers: { authorization: "Bearer " + token } });
  let j = await res.json();
  const ids = (j.data || []).map((m) => m.id);
  check("/v1/models 列出勾选的模型和别名", ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4-5", "gemini-2.5-flash", "flash"].every((m) => ids.includes(m)), ids);
  res = await ext("/v1beta/models", { method: "GET", headers: { "x-goog-api-key": token } });
  j = await res.json();
  check("/v1beta/models 返回 Gemini 格式", Array.isArray(j.models) && j.models.some((m) => m.name === "models/gpt-4o"), j);
  r = await ui("/api/token", { method: "POST" });
  const newToken = r.body.token;
  res = await ext("/v1/models", { method: "GET", headers: { authorization: "Bearer " + token } });
  check("重置后旧令牌失效", res.status === 401, res.status);
  res = await ext("/v1/models", { method: "GET", headers: { authorization: "Bearer " + newToken } });
  check("重置后新令牌可用", res.status === 200, res.status);
  token = newToken;

  console.log("\n[5] 三种格式互转 × 流式/非流式");
  const targets = [
    { model: "gpt-4o-mini", prefix: "OA[gpt-4o-mini]", family: "openai", path: "/oa/v1/chat/completions" },
    { model: "claude-sonnet-4-5", prefix: "CL[claude-sonnet-4-5]", family: "claude", path: "/cl/v1/messages" },
    { model: "gemini-2.5-flash", prefix: "GM[gemini-2.5-flash]", family: "gemini", path: "/gm/v1beta/models/gemini-2.5-flash:" },
  ];
  for (const fmt of Object.keys(inbound)) {
    for (const t of targets) {
      for (const stream of [false, true]) {
        await mockReset();
        const out = await inbound[fmt].call(t.model, stream, token);
        const log = await mockLog();
        const up = log.find((l) => l.method === "POST");
        const label = `${fmt} 格式 → ${t.family} 上游 ${stream ? "流式" : "非流式"}`;
        const ok =
          out.status === 200 &&
          typeof out.text === "string" &&
          out.text.startsWith(t.prefix) &&
          out.text.includes(PROMPT) &&
          up?.path.startsWith(t.path) &&
          (!stream || (out.done && out.chunks > 2 && out.ctype?.includes("text/event-stream")));
        check(label, ok, { out, up: up && { path: up.path } });
        // 同家原样转发：未知字段应保留；系统提示词应到达上游
        if (fmt === "openai" && t.family === "openai") check(`  同家转发保留未知字段（${stream ? "流式" : "非流式"}）`, up?.body?.extra_passthrough_field === 42, up?.body);
        if (fmt !== "openai" && t.family === "openai") check(`  系统提示词转换到 OpenAI 上游`, JSON.stringify(up?.body?.messages || []).includes("be nice"), up?.body);
        if (t.family === "claude") check(`  转到 Claude 时带上 system 和 max_tokens`, JSON.stringify(up?.body?.system || "").includes("be nice") && up?.body?.max_tokens > 0, up?.body);
        if (t.family === "gemini") check(`  转到 Gemini 时带上 systemInstruction`, JSON.stringify(up?.body?.systemInstruction || "").includes("be nice"), up?.body);
        if (!stream && out.usage) {
          const u = out.usage;
          check(`  用量字段转换为 ${fmt} 格式`, fmt === "openai" ? u.prompt_tokens > 0 : fmt === "claude" ? u.input_tokens > 0 : u.promptTokenCount > 0, u);
        }
      }
    }
  }

  console.log("\n[6] 别名、失败切换");
  await mockReset();
  let out = await inbound.openai.call("flash", false, token);
  let log = await mockLog();
  check("别名 flash 映射到上游 gemini-2.5-flash", out.status === 200 && out.text?.startsWith("GM[gemini-2.5-flash]") && log.some((l) => l.path.includes("/models/gemini-2.5-flash:")), { out, log: log.map((l) => l.path) });
  await mockReset();
  out = await inbound.openai.call("gpt-4o", false, token);
  log = await mockLog();
  check(
    "gpt-4o 先走优先级 1 的坏线路，失败后自动切到 OpenAI",
    out.status === 200 && out.text?.startsWith("OA[gpt-4o]") && log[0]?.path.startsWith("/bad/") && log[1]?.path.startsWith("/oa/"),
    { out: out.text, log: log.map((l) => l.path) },
  );
  await mockReset();
  out = await inbound.claude.call("gpt-4o", true, token);
  log = await mockLog();
  check("流式请求同样会切换线路", out.status === 200 && out.text?.startsWith("OA[gpt-4o]") && log[0]?.path.startsWith("/bad/"), { out, log: log.map((l) => l.path) });
  res = await ext("/v1/chat/completions", { headers: { authorization: "Bearer " + token }, body: { model: "no-such-model", messages: [{ role: "user", content: "hi" }] } });
  j = await res.json();
  check("不存在的模型返回 OpenAI 风格的错误", res.status >= 400 && j.error?.message, { status: res.status, j });
  res = await ext("/v1/messages", { headers: { "x-api-key": token }, body: { model: "no-such-model", max_tokens: 10, messages: [{ role: "user", content: "hi" }] } });
  j = await res.json();
  check("Claude 入口的错误是 Claude 格式", res.status >= 400 && j.type === "error" && j.error?.message, { status: res.status, j });

  console.log("\n[7] 生图");
  await mockReset();
  res = await ext("/v1/images/generations", { headers: { authorization: "Bearer " + token }, body: { model: "gpt-image-1", prompt: "一只猫", n: 2, size: "1024x1024" } });
  j = await res.json();
  log = await mockLog();
  check("/v1/images/generations 返回 2 张图", res.status === 200 && j.data?.length === 2 && (j.data[0].url || j.data[0].b64_json), { status: res.status, j: JSON.stringify(j).slice(0, 300) });
  check("生图请求转到上游 images/generations", log.some((l) => l.path === "/oa/v1/images/generations" && l.body.prompt === "一只猫"), log.map((l) => l.path));
  res = await ext("/v1/images/generations", { headers: { authorization: "Bearer " + token }, body: { model: "gpt-image-1", prompt: "一只狗", response_format: "b64_json" } });
  j = await res.json();
  check("response_format=b64_json 返回 base64", res.status === 200 && typeof j.data?.[0]?.b64_json === "string", JSON.stringify(j).slice(0, 200));

  r = await ui("/api/images", { method: "POST", body: { model: "gpt-image-1", prompt: "聊天页生图测试", n: 1, size: "1024x1024" } });
  const imgEvents = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
  check("聊天页生图接口成功", r.status === 200 && /\/api\/files\/|https?:\/\//.test(imgEvents), imgEvents.slice(0, 400));
  r = await ui("/api/gallery");
  check("生成的图进了图库", r.body.items?.some((i) => i.prompt === "聊天页生图测试"), r.body);
  const g = r.body.items?.[0];
  if (g) {
    const f = await fetch(new URL(g.url, APP), { headers: { cookie } });
    const ct = f.headers.get("content-type");
    check("图库图片可以打开", f.status === 200 && ct?.startsWith("image/"), { status: f.status, ct });
    r = await ui(`/api/gallery/${g.id}`, { method: "DELETE" });
    check("图库删除", r.status === 200, r);
  }

  console.log("\n[8] 聊天页流式接口与人设");
  await ui("/api/settings", { method: "PUT", body: { callMode: "producer", personaInModel: true } });
  await mockReset();
  const cr = await fetch(APP + "/api/chat", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", messages: [{ id: "u1", role: "user", text: "来自聊天页", createdAt: Date.now() }] }),
  });
  const chat = await readSSE(cr);
  log = await mockLog();
  const txt = chat.events.filter((e) => e.event === "text").map((e) => e.data.t ?? e.data.text ?? e.data).join("");
  check("聊天页流式返回文字", cr.status === 200 && txt.includes("来自聊天页"), chat.raw.slice(0, 500));
  check("打开「棱音口吻」后人设提示词发给模型，称呼为制作人", JSON.stringify(log[0]?.body?.system || "").includes("棱音") && JSON.stringify(log[0]?.body?.system || "").includes("制作人"), log[0]?.body?.system);
  await ui("/api/settings", { method: "PUT", body: { callMode: "you", personaInModel: false } });

  console.log("\n[9] 请求日志");
  r = await ui("/api/logs");
  const logs = r.body.logs || [];
  check("日志有记录", logs.length > 10, logs.length);
  check("日志记录了切换次数", logs.some((l) => l.attempts === 2 && l.ok), logs.slice(0, 3));
  check("日志记录了失败请求", logs.some((l) => !l.ok), null);
  check("日志记录了流式首字时间", logs.some((l) => l.stream && typeof l.ttfbMs === "number"), null);

  console.log("\n[10] 连续 3 次超时自动停用（约 15 秒）");
  const SLOW = await mk({ type: "openai", baseUrl: `${MOCK}/slow`, key: "sk-slow-123456", name: "慢线路", timeoutMs: 5000, priority: 0 });
  await ui(`/api/channels/${SLOW.id}`, { method: "PATCH", body: { models: ["slow-model"] } });
  for (let i = 0; i < 3; i++) {
    res = await ext("/v1/chat/completions", { headers: { authorization: "Bearer " + token }, body: { model: "slow-model", messages: [{ role: "user", content: "hi" }] } });
    await res.text();
  }
  r = await ui("/api/channels");
  const slow = r.body.channels.find((c) => c.id === SLOW.id);
  check("连续 3 次超时后线路被自动停用", slow?.autoDisabled === true, slow);
  res = await ext("/v1/models", { method: "GET", headers: { authorization: "Bearer " + token } });
  j = await res.json();
  check("停用后模型不再出现在 /v1/models", !j.data.some((m) => m.id === "slow-model"), j.data.map((m) => m.id));

  console.log("\n[11] 渠道启用/停用/删除、重新看引导、登出登入");
  r = await ui(`/api/channels/${BAD.id}`, { method: "PATCH", body: { enabled: false } });
  check("停用渠道", r.body.channel?.enabled === false, r.body);
  await mockReset();
  out = await inbound.openai.call("gpt-4o", false, token);
  log = await mockLog();
  check("停用后不再请求这条线路", out.status === 200 && !log.some((l) => l.path.startsWith("/bad/")), log.map((l) => l.path));
  r = await ui(`/api/channels/${SLOW.id}`, { method: "DELETE" });
  check("删除渠道", r.status === 200, r);
  r = await ui("/api/channels");
  check("删除后列表里没有了", !r.body.channels.some((c) => c.id === SLOW.id), r.body.channels.map((c) => c.name));
  r = await ui("/api/onboarding", { method: "PUT", body: { reset: true } });
  check("重新看引导会重置进度", r.body.onboarding?.completed === false, r.body);
  r = await ui("/");
  check("重置后 / 跳到 /onboarding", r.status === 307, r.status);
  r = await ui("/onboarding");
  check("引导页显示「密码已设好」", String(r.body).includes("访问密码已经设好啦"), null);
  await ui("/api/onboarding", { method: "PUT", body: { completed: true } });
  await ui("/api/auth/logout", { method: "POST" });
  cookie = "";
  r = await ui("/");
  check("登出后 / 跳到 /login", r.status === 307 && r.headers.get("location")?.endsWith("/login"), r.headers.get("location"));
  r = await ui("/login");
  check("登录页正常打开", r.status === 200 && String(r.body).includes("欢迎回来"), r.status);
  r = await ui("/onboarding");
  check("未登录访问引导页跳到 /login", r.status === 307 && r.headers.get("location")?.endsWith("/login"), r.headers.get("location"));
  r = await ui("/api/auth/login", { method: "POST", body: { password: "wrong-pass" } });
  check("错误密码登录失败", r.status >= 400, r);
  r = await ui("/api/auth/login", { method: "POST", body: { password: "test1234" } });
  check("正确密码登录成功", r.status === 200 && cookie, r);
  r = await ui("/");
  check("登录后进入聊天页", r.status === 200, r.status);

  console.log(`\n共 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
  if (fail) console.log("失败项：\n- " + failures.join("\n- "));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
