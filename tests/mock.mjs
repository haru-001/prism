// 模拟上游：/oa = OpenAI，/cl = Claude，/gm = Gemini，/bad = 永远 500 的 OpenAI，/slow = 永远超时的 OpenAI
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 9100);
const log = [];
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function lastText(body, fmt) {
  try {
    if (fmt === "gemini") {
      const c = body.contents[body.contents.length - 1];
      return c.parts.map((p) => p.text || (p.inlineData ? "[img]" : "")).join("");
    }
    const m = body.messages[body.messages.length - 1];
    if (typeof m.content === "string") return m.content;
    return m.content.map((p) => p.text || (p.type?.includes("image") ? "[img]" : "")).join("");
  } catch {
    return "?";
  }
}

function send(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function sse(res, events, raw = false) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const e of events) {
    if (raw) res.write(e);
    else if (e.event) res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
    else res.write(`data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}\n\n`);
    await new Promise((r) => setTimeout(r, 30));
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {}
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (p === "/_log") return send(res, 200, log);
  if (p === "/_reset") {
    log.length = 0;
    return send(res, 200, { ok: true });
  }
  log.push({
    method: req.method,
    path: p + url.search,
    auth: req.headers.authorization || req.headers["x-api-key"] || req.headers["x-goog-api-key"] || url.searchParams.get("key") || "",
    body,
  });

  // ---------- OpenAI ----------
  const oa = p.match(/^\/(oa|bad|slow)\/v1\/(.*)$/);
  if (oa) {
    const [, kind, rest] = oa;
    if (rest === "models" && req.method === "GET")
      return send(res, 200, {
        object: "list",
        data: ["gpt-4o", "gpt-4o-mini", "o3-mini", "gpt-image-1", "dall-e-3", "text-embedding-3-small", "whisper-1"].map((id) => ({ id, object: "model" })),
      });
    if (kind === "bad") return send(res, 500, { error: { message: "mock upstream down", type: "server_error" } });
    if (kind === "slow") {
      await new Promise((r) => setTimeout(r, 12000));
      return send(res, 500, { error: { message: "too late" } });
    }
    if (rest === "chat/completions") {
      const text = `OA[${body.model}]:${lastText(body)}`;
      if (body.stream) {
        const pieces = text.match(/.{1,6}/gsu) || [text];
        const ev = [
          { data: { id: "c1", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: "" } }] } },
          ...pieces.map((t) => ({ data: { id: "c1", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: { content: t } }] } })),
          { data: { id: "c1", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] } },
          { data: { id: "c1", object: "chat.completion.chunk", model: body.model, choices: [], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } } },
          { data: "[DONE]" },
        ];
        return sse(res, ev);
      }
      return send(res, 200, {
        id: "c1",
        object: "chat.completion",
        created: 1,
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      });
    }
    if (rest === "images/generations") {
      const n = body.n || 1;
      return send(res, 200, { created: 1, data: Array.from({ length: n }, () => ({ b64_json: PNG, revised_prompt: "mock: " + body.prompt })) });
    }
    return send(res, 404, { error: { message: "no route " + p } });
  }

  // ---------- Claude ----------
  if (p === "/cl/v1/models")
    return send(res, 200, { data: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-3-5-haiku-latest"].map((id) => ({ id, type: "model", display_name: id })), has_more: false });
  if (p === "/cl/v1/messages") {
    if (!req.headers["x-api-key"] || !req.headers["anthropic-version"]) return send(res, 401, { type: "error", error: { type: "authentication_error", message: "missing headers" } });
    const text = `CL[${body.model}]:${lastText(body)}`;
    if (body.stream) {
      const pieces = text.match(/.{1,6}/gsu) || [text];
      return sse(res, [
        { event: "message_start", data: { type: "message_start", message: { id: "m1", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, usage: { input_tokens: 9, output_tokens: 1 } } } },
        { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
        ...pieces.map((t) => ({ event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } } })),
        { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
        { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 6 } } },
        { event: "message_stop", data: { type: "message_stop" } },
      ]);
    }
    return send(res, 200, {
      id: "m1",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 9, output_tokens: 6 },
    });
  }

  // ---------- Gemini ----------
  if (p === "/gm/v1beta/models" && req.method === "GET")
    return send(res, 200, {
      models: [
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
      ],
    });
  const gm = p.match(/^\/gm\/v1beta\/models\/([^:]+):(generateContent|streamGenerateContent)$/);
  if (gm) {
    const [, model, method] = gm;
    const text = `GM[${decodeURIComponent(model)}]:${lastText(body, "gemini")}`;
    const usage = { promptTokenCount: 8, candidatesTokenCount: 5, totalTokenCount: 13 };
    if (method === "streamGenerateContent") {
      const pieces = text.match(/.{1,6}/gsu) || [text];
      return sse(
        res,
        pieces.map((t, i) => ({
          data: {
            candidates: [{ content: { role: "model", parts: [{ text: t }] }, ...(i === pieces.length - 1 ? { finishReason: "STOP" } : {}) }],
            ...(i === pieces.length - 1 ? { usageMetadata: usage } : {}),
          },
        })),
      );
    }
    return send(res, 200, { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: usage });
  }

  send(res, 404, { error: { message: "mock: no route " + p } });
});

server.listen(PORT, "127.0.0.1", () => console.log("mock upstream on", PORT));
