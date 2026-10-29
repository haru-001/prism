// 迁移测试（分两步）：
//   node tests/migrate-test.mjs snapshot   对着旧版（Upstash 存储）补一些对话和图片，再记下所有数据
//   node tests/migrate-test.mjs verify     迁移后对着新版（MySQL 存储）逐项对比
// 两步都用端口 3100，mock 在 9100。密码沿用 api-test 设的 test1234。
import fs from "node:fs";

const APP = process.env.APP || "http://127.0.0.1:3100";
const SNAP = "/tmp/prism-migrate-snapshot.json";
const mode = process.argv[2];
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
async function ui(path, { method = "GET", body } = {}) {
  const r = await fetch(APP + path, { method, redirect: "manual", headers: { cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const t = await r.text();
  try {
    return { status: r.status, body: JSON.parse(t) };
  } catch {
    return { status: r.status, body: t };
  }
}
const sha = async (url) => {
  const r = await fetch(new URL(url, APP), { headers: { cookie } });
  const b = Buffer.from(await r.arrayBuffer());
  return r.status + ":" + (await import("node:crypto")).createHash("sha256").update(b).digest("hex");
};

async function collect() {
  const channels = (await ui("/api/channels")).body.channels;
  const convs = (await ui("/api/conversations")).body.conversations;
  const full = [];
  for (const c of convs) full.push((await ui("/api/conversations/" + c.id)).body);
  const gallery = (await ui("/api/gallery")).body.items;
  const images = {};
  for (const g of gallery) images[g.url] = await sha(g.url);
  return {
    channels,
    convs,
    full,
    gallery,
    images,
    logs: (await ui("/api/logs")).body.logs,
    settings: (await ui("/api/settings")).body,
    onboarding: (await ui("/api/onboarding")).body,
    token: (await ui("/api/token")).body.token,
  };
}

const r0 = await ui("/api/auth/login", { method: "POST", body: { password: "test1234" } });
if (r0.status !== 200) {
  console.log("登录失败", r0);
  if (mode === "snapshot") process.exit(1);
}

if (mode === "snapshot") {
  const now = Date.now();
  for (let i = 0; i < 3; i++) {
    const id = "conv" + i + "x" + now;
    await ui("/api/conversations/" + id, {
      method: "PUT",
      body: { id, title: "迁移测试对话 " + i + " ✨中文", model: "gpt-4o", hasImage: false, createdAt: now + i, updatedAt: now + i, messages: [{ id: "m" + i, role: "user", text: "你好，棱音 " + i, createdAt: now + i }] },
    });
  }
  for (let i = 0; i < 2; i++) await ui("/api/images", { method: "POST", body: { model: "gpt-image-1", prompt: "迁移测试图 " + i, n: 1, size: "1024x1024" } });
  const snap = await collect();
  fs.writeFileSync(SNAP, JSON.stringify(snap));
  console.log(`已记录：渠道 ${snap.channels.length}，对话 ${snap.convs.length}，图库 ${snap.gallery.length}，日志 ${snap.logs.length}`);
} else {
  const old = JSON.parse(fs.readFileSync(SNAP, "utf8"));
  check("用旧密码登录成功", r0.status === 200, r0);
  const now = await collect();
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check(`渠道一致（${old.channels.length} 条）`, eq(old.channels, now.channels), now.channels?.length);
  check(`对话列表一致（${old.convs.length} 个）`, old.convs.length > 0 && eq(old.convs, now.convs), now.convs);
  check("对话内容一致（含中文和 emoji）", eq(old.full, now.full));
  check(`图库一致（${old.gallery.length} 张）`, old.gallery.length > 0 && eq(old.gallery, now.gallery), now.gallery);
  check("图片地址不变、内容逐字节一致", eq(old.images, now.images) && Object.values(now.images).every((x) => x.startsWith("200:")), now.images);
  check(`请求日志一致且顺序不变（${old.logs.length} 条）`, old.logs.length > 0 && eq(old.logs, now.logs), now.logs?.length);
  check("设置一致", eq(old.settings, now.settings));
  check("引导进度一致", eq(old.onboarding, now.onboarding));
  check("访问令牌一致", old.token && old.token === now.token);
  const m = await fetch(APP + "/v1/models", { headers: { authorization: "Bearer " + old.token } });
  check("旧令牌能调 /v1/models", m.status === 200, m.status);
  const oa = now.channels.find((c) => c.type === "openai" && c.enabled !== false) || now.channels[0];
  const t = await ui(`/api/channels/${oa.id}/test`, { method: "POST", body: {} });
  check("加密的上游 Key 能解开（测试延迟成功）", t.body.ok === true, t.body);
  console.log(`\n迁移测试：${pass} 项通过，${failures.length} 项失败`);
  if (failures.length) process.exit(1);
}
