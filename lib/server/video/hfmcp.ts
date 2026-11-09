import "server-only";
import { isSpaceName, isToolName } from "../../video";

/**
 * Hugging Face 官方 MCP 服务的极简客户端（直接用 fetch，不装 SDK）。
 *
 * 协议是 MCP 的 Streamable HTTP（JSON-RPC 2.0）：
 *   1. POST initialize          → 响应头里拿 Mcp-Session-Id
 *   2. POST notifications/initialized（带会话头，返回 202）
 *   3. POST tools/call          → 带 params._meta.progressToken 时，服务端用 SSE 推进度（notifications/progress），最后推结果
 *   4. DELETE 会话（尽力而为）
 * 调用 Space 用的是 dynamic_space 工具：{ operation: "invoke" | "view_parameters", space_name, tool_name, parameters }。
 *
 * 只请求 huggingface.co（测试时可以用 PRISM_TEST_HF_ORIGIN 指到本地模拟服务）。
 */
export const HF_ORIGIN = (process.env.PRISM_TEST_HF_ORIGIN || "https://huggingface.co").replace(/\/+$/, "");
const MCP_URL = HF_ORIGIN + "/mcp?mix=dynamic_space";
const PROTOCOL = "2025-06-18";

export class HfError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export interface McpProgress {
  progress?: number;
  total?: number;
  message?: string;
}

interface RpcMsg {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: { content?: { type: string; text?: string; resource?: { uri?: string }; uri?: string }[]; isError?: boolean; structuredContent?: unknown };
  error?: { code: number; message: string };
}

function headers(token: string, sid?: string): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL,
    "user-agent": "Prism/1 (+video)",
  };
  if (token) h.authorization = `Bearer ${token}`;
  if (sid) h["mcp-session-id"] = sid;
  return h;
}

async function errorText(res: Response) {
  const t = await res.text().catch(() => "");
  try {
    const j = JSON.parse(t);
    return j?.error?.message || j?.error || j?.message || t;
  } catch {
    return t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  }
}

/** 读 SSE：每个 data 块是一条 JSON-RPC 消息 */
async function readSse(res: Response, onMsg: (m: RpcMsg) => void) {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const flush = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return;
    try {
      onMsg(JSON.parse(data));
    } catch {}
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const m = /\r?\n\r?\n/.exec(buf)!;
      flush(buf.slice(0, i));
      buf = buf.slice(i + m[0].length);
    }
  }
  if (buf.trim()) flush(buf);
}

async function openSession(token: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "prism", version: "1" } } }),
    signal,
  });
  if (!res.ok) throw new HfError(await errorText(res), res.status);
  const sid = res.headers.get("mcp-session-id") || "";
  await res.body?.cancel().catch(() => {});
  const n = await fetch(MCP_URL, { method: "POST", headers: headers(token, sid), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), signal });
  await n.body?.cancel().catch(() => {});
  return sid;
}

function closeSession(token: string, sid: string) {
  if (!sid) return;
  void fetch(MCP_URL, { method: "DELETE", headers: headers(token, sid), signal: AbortSignal.timeout(5000) })
    .then((r) => r.body?.cancel())
    .catch(() => {});
}

/**
 * 调一个 MCP 工具，返回 result。onProgress 收到服务端推的进度（排队、生成百分比）。
 * 工具自己报错（isError）时抛 HfError，message 是工具给的原文。
 */
export async function mcpCall(
  token: string,
  name: string,
  args: Record<string, unknown>,
  opts: { signal?: AbortSignal; onProgress?: (p: McpProgress) => void } = {},
): Promise<NonNullable<RpcMsg["result"]>> {
  const sid = await openSession(token, opts.signal);
  try {
    const id = 2;
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: headers(token, sid),
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args, _meta: { progressToken: `prism-${Date.now()}` } } }),
      signal: opts.signal,
    });
    if (!res.ok) throw new HfError(await errorText(res), res.status);
    let final: RpcMsg | null = null;
    if ((res.headers.get("content-type") || "").includes("text/event-stream")) {
      await readSse(res, (m) => {
        if (m.method === "notifications/progress" && m.params) {
          opts.onProgress?.({ progress: Number(m.params.progress), total: m.params.total != null ? Number(m.params.total) : undefined, message: m.params.message as string | undefined });
        } else if (m.id === id) final = m;
      });
    } else {
      final = (await res.json().catch(() => null)) as RpcMsg | null;
    }
    const f = final as RpcMsg | null;
    if (!f) throw new HfError("Hugging Face 没有返回结果（连接提前断开）", 502);
    if (f.error) throw new HfError(f.error.message || "MCP 调用出错", 502);
    const r = f.result || {};
    if (r.isError) throw new HfError(textOf(r) || "Space 返回了错误", 422);
    return r;
  } finally {
    closeSession(token, sid);
  }
}

export function textOf(r: RpcMsg["result"]): string {
  return (r?.content || [])
    .map((c) => c.text || c.resource?.uri || c.uri || "")
    .filter(Boolean)
    .join("\n");
}

/** 从 Space 的返回里找视频地址：优先 .mp4/.webm，其次 Gradio 的 /gradio_api/file= 地址 */
export function findVideoUrl(r: RpcMsg["result"]): string | null {
  const t = textOf(r);
  const urls = t.match(/https?:\/\/[^\s"'<>)\]]+/g) || [];
  return urls.find((u) => /\.(mp4|webm|mov)(\?|$)/i.test(u)) || urls.find((u) => /gradio_api\/file=/.test(u)) || null;
}

/** 「测试连接」：hf_whoami 只读账号信息，不消耗 GPU 额度 */
export async function hfWhoami(token: string): Promise<{ name: string; pro: boolean; role?: string }> {
  const r = await mcpCall(token, "hf_whoami", {}, { signal: AbortSignal.timeout(20000) });
  const s = r.structuredContent as { status?: string; account?: { name?: string; is_pro?: boolean }; credential?: { role?: string } } | undefined;
  if (s?.status && s.status !== "authenticated") throw new HfError("令牌无效或已过期", 401);
  const name = s?.account?.name || /Authenticated as \[@?([^\]]+)\]/.exec(textOf(r))?.[1] || "";
  if (!name) throw new HfError("没认出账号，令牌可能无效", 401);
  return { name, pro: !!s?.account?.is_pro, role: s?.credential?.role };
}

/** 调 Space 的工具（会消耗 ZeroGPU 额度） */
export function invokeSpace(
  token: string,
  space: string,
  tool: string | undefined,
  parameters: Record<string, unknown>,
  opts: { signal?: AbortSignal; onProgress?: (p: McpProgress) => void },
) {
  if (!isSpaceName(space)) throw new HfError("Space 名称格式不对，应为 owner/name", 400);
  if (tool && !isToolName(tool)) throw new HfError("工具名格式不对", 400);
  return mcpCall(token, "dynamic_space", { operation: "invoke", space_name: space, ...(tool ? { tool_name: tool } : {}), parameters }, opts);
}

export interface SpaceParam {
  name: string;
  type: string;
  file: boolean;
  enumValues?: string[];
}

/** view_parameters：读 Space 工具的参数表（Markdown），解析出参数名和类型。不消耗额度 */
export async function viewParameters(token: string, space: string, tool?: string): Promise<{ tool: string; params: SpaceParam[]; tools?: string[] }> {
  if (!isSpaceName(space)) throw new HfError("Space 名称格式不对，应为 owner/name", 400);
  const r = await mcpCall(token, "dynamic_space", { operation: "view_parameters", space_name: space, ...(tool ? { tool_name: tool } : {}) }, { signal: AbortSignal.timeout(30000) });
  const t = textOf(r);
  if (/^Error:/i.test(t.trim())) {
    const tools = [...t.matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
    throw Object.assign(new HfError(t.trim().slice(0, 300), 404), { tools });
  }
  const name = /# Parameters for:\s*([A-Za-z0-9_]+)/.exec(t)?.[1] || tool || "";
  const params: SpaceParam[] = [];
  for (const blk of t.split(/\n### /).slice(1)) {
    const pn = /^([A-Za-z0-9_]+)/.exec(blk)?.[1];
    if (!pn) continue;
    const type = /\*\*Type:\*\*\s*([^\n]+)/.exec(blk)?.[1]?.trim() || "";
    const allowed = /\*\*Allowed values:\*\*\s*([^\n]+)/.exec(blk)?.[1];
    params.push({
      name: pn,
      type,
      file: /file url/i.test(type),
      enumValues: allowed ? [...allowed.matchAll(/"([^"]+)"/g)].map((m) => m[1]) : undefined,
    });
  }
  return { tool: name, params };
}

/**
 * 把参考图交给 Space：先查 Space 的子域名（huggingface.co/api/spaces/{id}），
 * 再 POST 到 https://{子域}.hf.space/gradio_api/upload，拼出 Space 自己能读的公网地址。
 * 只会请求 huggingface.co 和 *.hf.space。
 */
export async function uploadToSpace(token: string, space: string, img: { data: Buffer; mime: string }, signal?: AbortSignal): Promise<string> {
  const host = await spaceHost(token, space, signal);
  const fd = new FormData();
  const ext = img.mime === "image/png" ? "png" : "jpg";
  fd.append("files", new Blob([new Uint8Array(img.data)], { type: img.mime }), `prism.${ext}`);
  const res = await fetch(`${host}/gradio_api/upload`, { method: "POST", body: fd, signal });
  if (!res.ok) throw new HfError(`参考图上传到 Space 失败（${res.status}）`, res.status);
  const arr = (await res.json().catch(() => null)) as string[] | null;
  const path = Array.isArray(arr) ? arr[0] : null;
  if (!path || typeof path !== "string" || path.includes("..")) throw new HfError("参考图上传到 Space 后没拿到文件地址", 502);
  return `${host}/gradio_api/file=${path}`;
}

const hostCache = new Map<string, { host: string; at: number }>();
export async function spaceHost(token: string, space: string, signal?: AbortSignal): Promise<string> {
  if (!isSpaceName(space)) throw new HfError("Space 名称格式不对，应为 owner/name", 400);
  const hit = hostCache.get(space);
  if (hit && Date.now() - hit.at < 3600_000) return hit.host;
  const test = process.env.PRISM_TEST_HF_SPACE_ORIGIN;
  let host: string;
  if (test) host = test.replace(/\/+$/, "");
  else {
    const res = await fetch(`${HF_ORIGIN}/api/spaces/${space}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal });
    if (res.status === 404) throw new HfError(`找不到 Space「${space}」，可能名字写错了或者是私有的`, 404);
    if (!res.ok) throw new HfError(`查询 Space 信息失败（${res.status}）`, res.status);
    const j = (await res.json()) as { host?: string; subdomain?: string; runtime?: { stage?: string } };
    host = j.host || (j.subdomain ? `https://${j.subdomain}.hf.space` : "");
    if (!/^https:\/\/[a-z0-9-]+\.hf\.space$/.test(host)) throw new HfError("这个 Space 没有可用的地址（可能没在运行）", 502);
    // 休眠中（SLEEPING）的 Space 收到请求会自己醒，只拦明确出错或被暂停的
    if (j.runtime?.stage && /ERROR|PAUSED|NO_APP_FILE|DELETING/.test(j.runtime.stage)) {
      throw new HfError(`这个 Space 现在用不了（状态：${j.runtime.stage}），换一个 Space 试试`, 503);
    }
  }
  hostCache.set(space, { host, at: Date.now() });
  return host;
}
