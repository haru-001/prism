import "server-only";
import { getDetail } from "./logdetail";
import { REPLAY_TOKEN } from "./tokens";
import { handleClaudeMessages, handleGemini, handleImages, handleOpenAIChat } from "./relay/inbound";
import { runUiChat } from "./ui/chat";
import { runUiImages } from "./ui/images";

/** 重放结果最多带回这么多字给页面看（完整内容在新日志的详情里） */
const BODY_MAX = 16 * 1024;

export type ReplayResult =
  | { ok: true; status: number; contentType: string; body: string; ms: number }
  | { ok: false; status: number; error: string };

/**
 * 一键重放：用日志详情里存的请求体，在服务端直接再调一次对应的入口。
 * - 走「日志重放」令牌（不受令牌限制，日志里能看出来是重放）
 * - 会正常经过线路选择和失败切换，也会记一条新日志和用量
 * - 请求体被截断过、图片被省略过的不能重放（内容已经不完整了）
 */
export async function replayLog(id: string): Promise<ReplayResult> {
  const d = await getDetail(id);
  if (!d) return { ok: false, status: 404, error: "这条日志的详情已经不在了（只保留最近 500 条）" };
  if (d.truncated) return { ok: false, status: 400, error: "这条请求的内容被截断过或省略了图片，没法原样重放" };
  if (d.request.method !== "POST" || !d.request.body) return { ok: false, status: 400, error: "只有带请求体的 POST 请求能重放" };

  const path = d.request.path.split("?")[0];
  const search = d.request.path.includes("?") ? d.request.path.slice(d.request.path.indexOf("?")) : "";
  let body = d.request.body;
  const headers: Record<string, string> = { "content-type": "application/json" };
  const av = Object.entries(d.request.headers).find(([k]) => k.toLowerCase() === "anthropic-version");
  if (av) headers["anthropic-version"] = av[1];

  if (path === "/api/images") {
    // 重放出来的图不挂回原来的对话
    try {
      const j = JSON.parse(body);
      delete j.convId;
      body = JSON.stringify(j);
    } catch {
      /* 原样 */
    }
  }

  // 去掉查询里的 key（已打码，也用不上）
  const sp = new URLSearchParams(search);
  sp.delete("key");
  const qs = sp.toString();
  const req = new Request("http://prism.internal" + path + (qs ? "?" + qs : ""), { method: "POST", headers, body });
  const inv = { token: REPLAY_TOKEN, replayOf: id };

  let run: () => Promise<Response>;
  if (path === "/v1/chat/completions") run = () => handleOpenAIChat(req, inv);
  else if (path === "/v1/messages") run = () => handleClaudeMessages(req, inv);
  else if (path === "/v1/images/generations") run = () => handleImages(req, inv);
  else if (path === "/api/chat") run = () => runUiChat(req, id);
  else if (path === "/api/images") run = () => runUiImages(req, id);
  else if (path.startsWith("/v1beta/models/")) {
    const tail = decodeURIComponent(path.slice("/v1beta/models/".length));
    const i = tail.lastIndexOf(":");
    if (i < 0) return { ok: false, status: 400, error: "Gemini 路径不完整，没法重放" };
    run = () => handleGemini(req, tail.slice(0, i), tail.slice(i + 1));
  } else return { ok: false, status: 400, error: `不支持重放这个接口：${path}` };

  const started = Date.now();
  const res = await run();
  const text = await res.text();
  return {
    ok: true,
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    body: text.length > BODY_MAX ? text.slice(0, BODY_MAX) + `\n…（已截断，原长 ${text.length} 字）` : text,
    ms: Date.now() - started,
  };
}
