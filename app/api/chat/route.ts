import { guard } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/store";
import { describeError, readJSON } from "@/lib/server/api";
import { adapterChat } from "@/lib/server/relay/adapters";
import { inlineImages, logFailure, withFailover, withLogging, type FailoverError } from "@/lib/server/relay/router";
import { SSE_HEADERS, sseLine, streamFrom } from "@/lib/server/relay/sse";
import { callName, fill, PERSONA_SYSTEM_PROMPT } from "@/lib/copy";
import type { ChatMsg, IChatRequest, IMessage, IPart } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  model: string;
  channelId?: string;
  messages: ChatMsg[];
  system?: string;
  temperature?: number;
}

function toInternal(msgs: ChatMsg[]): IMessage[] {
  const out: IMessage[] = [];
  for (const m of msgs) {
    if (m.role === "notice" || m.mode === "image" || m.error || m.pending) continue;
    const parts: IPart[] = [];
    for (const url of m.images || []) parts.push({ type: "image", url });
    if (m.text) parts.push({ type: "text", text: m.text });
    if (parts.length) out.push({ role: m.role === "assistant" ? "assistant" : "user", content: parts });
  }
  return out;
}

/** 聊天界面专用的流式接口：输出内部事件（meta / notice / text / reasoning / usage / done / error） */
export async function POST(req: Request) {
  const g = await guard();
  if (g) return g;
  const body = await readJSON<Body>(req);
  if (!body?.model || !Array.isArray(body.messages)) return Response.json({ error: "参数不完整" }, { status: 400 });
  const settings = await getSettings();
  const name = callName(settings.callMode, settings.customName);
  const sys = [settings.personaInModel ? fill(PERSONA_SYSTEM_PROMPT, { name }) : "", (body.system ?? settings.defaultSystem)?.trim() || ""]
    .filter(Boolean)
    .join("\n\n");
  const base: IChatRequest = {
    model: body.model,
    system: sys || undefined,
    messages: toInternal(body.messages),
    temperature: body.temperature ?? settings.temperature,
    stream: true,
  };
  const startedAt = Date.now();

  async function* run(): AsyncGenerator<string> {
    let internal: IChatRequest;
    try {
      internal = await inlineImages(base);
    } catch (e) {
      yield sseLine({ title: "图片读取失败", message: (e as Error).message }, "error");
      return;
    }
    let routed;
    try {
      routed = await withFailover(
        body!.model,
        (t) => adapterChat(t, { ...internal, model: t.upstreamModel }, req.signal),
        { prefer: body!.channelId },
      );
    } catch (e) {
      for (const n of (e as FailoverError).notices || []) yield sseLine(n, "notice");
      await logFailure("ui", body!.model, e, startedAt, true);
      yield sseLine(describeError(e, settings, body!.model), "error");
      return;
    }
    for (const n of routed.notices) yield sseLine(n, "notice");
    yield sseLine({ channel: routed.target.channel.name, channelId: routed.target.channel.id, upstream: routed.target.upstreamModel }, "meta");
    const events = withLogging(routed.value, {
      source: "ui",
      model: body!.model,
      target: routed.target,
      attempts: routed.attempts,
      startedAt,
      stream: true,
    });
    try {
      for await (const ev of events) {
        if (ev.type === "text" || ev.type === "reasoning") yield sseLine({ t: ev.text }, ev.type);
        else if (ev.type === "usage") yield sseLine(ev.usage, "usage");
        else if (ev.type === "finish") yield sseLine({ reason: ev.reason }, "finish");
      }
      yield sseLine({ latencyMs: Date.now() - startedAt }, "done");
    } catch (e) {
      if (req.signal.aborted) return;
      const err = e as Error;
      yield sseLine(describeError(Object.assign(err, { channel: routed.target.channel.name }), settings, body!.model), "error");
    }
  }

  return new Response(streamFrom(run()), { headers: SSE_HEADERS });
}
