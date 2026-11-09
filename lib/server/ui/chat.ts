import "server-only";
import { captured, newCtx, type ReqCtx } from "@/lib/server/relay/capture";
import { REPLAY_TOKEN, WEB_TOKEN } from "@/lib/server/tokens";
import { addGallery, getSettings } from "@/lib/server/store";
import { persistRemoteImage, saveBase64Image } from "@/lib/server/files";
import { describeError, readJSON } from "@/lib/server/api";
import { adapterChat } from "@/lib/server/relay/adapters";
import { inlineImages, logFailure, withFailover, withLogging, type FailoverError } from "@/lib/server/relay/router";
import { SSE_HEADERS, sseLine, streamFrom } from "@/lib/server/relay/sse";
import { callName, fill, PERSONA_SYSTEM_PROMPT } from "@/lib/copy";
import type { ChatMsg, IChatRequest, IMessage, IPart } from "@/lib/types";


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
    // alt：并排对比里没被选用的回答，不进入后续上下文
    if (m.role === "notice" || m.mode === "image" || m.mode === "video" || m.error || m.pending || m.alt) continue;
    const parts: IPart[] = [];
    // 回答里生成的图不回传给上游（OpenAI 等不接受 assistant 消息里带图片，会直接 400）
    if (m.role !== "assistant") for (const url of m.images || []) parts.push({ type: "image", url });
    if (m.text) parts.push({ type: "text", text: m.text });
    if (parts.length) out.push({ role: m.role === "assistant" ? "assistant" : "user", content: parts });
  }
  return out;
}

/**
 * 回答文本里内嵌的 ![](data:image/...;base64,...)：存成站内文件，换成站内地址。
 * react-markdown 默认会把 data: 地址清掉（图就不见了），而且几 MB 的 base64 存进对话也太大。
 * 流式时可能被切成好几段：从最后一个还没闭合的「![」开始先压着，凑齐了再处理。
 */
class DataImageFilter {
  private buf = "";
  constructor(private save: (dataUrl: string) => Promise<string | null>) {}
  private static RE = /!\[([^\]\n]*)\]\(\s*(data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=_\s-]+?)\s*\)/gi;
  async push(chunk: string): Promise<string> {
    this.buf += chunk;
    let out = "";
    // 先处理已经完整的
    this.buf = await this.replaceAll(this.buf);
    const i = this.buf.lastIndexOf("![");
    if (i < 0) {
      out = this.buf;
      this.buf = "";
      return out;
    }
    const tail = this.buf.slice(i);
    const pending = /^!\[[^\]\n]*(\](\(\s*(d(a(t(a(:[^)]*)?)?)?)?)?)?)?$/i.test(tail) || (/^!\[[^\]\n]*\]\(\s*data:/i.test(tail) && !tail.includes(")"));
    if (pending && tail.length < 30 * 1024 * 1024) {
      out = this.buf.slice(0, i);
      this.buf = tail;
    } else {
      out = this.buf;
      this.buf = "";
    }
    return out;
  }
  async flush(): Promise<string> {
    const out = await this.replaceAll(this.buf);
    this.buf = "";
    return out;
  }
  private async replaceAll(s: string): Promise<string> {
    const hits = [...s.matchAll(DataImageFilter.RE)];
    if (!hits.length) return s;
    let res = "";
    let last = 0;
    for (const h of hits) {
      const url = await this.save(h[2].replace(/\s+/g, ""));
      res += s.slice(last, h.index) + (url ? `![${h[1] || "image"}](${url})` : "");
      last = h.index! + h[0].length;
    }
    return res + s.slice(last);
  }
}

/** 聊天界面专用的流式接口：输出内部事件（meta / notice / text / reasoning / usage / done / error） */
/** 网页端请求也记详情（令牌记为「网页聊天」）；日志重放时直接调这里 */
export function runUiChat(req: Request, replayOf?: string) {
  const ctx = newCtx(replayOf ? REPLAY_TOKEN : WEB_TOKEN, replayOf);
  return captured(req, ctx, (r) => handle(r, ctx));
}

async function handle(req: Request, ctx: ReqCtx) {
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
      await logFailure("ui", body!.model, e, startedAt, true, ctx);
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
      ctx,
    });
    // 回答里的图：存成站内文件，同时放进图库
    const prompt = [...body!.messages].reverse().find((m) => m.role === "user" && m.text)?.text?.slice(0, 500) || "";
    const saved: string[] = [];
    const keep = async (url: string | null) => {
      if (!url) return null;
      saved.push(url);
      return url;
    };
    const filter = new DataImageFilter(async (d) => keep(await saveBase64Image(d).catch(() => null)));
    try {
      for await (const ev of events) {
        if (ev.type === "text") {
          const t = await filter.push(ev.text);
          if (t) yield sseLine({ t }, "text");
        } else if (ev.type === "reasoning") yield sseLine({ t: ev.text }, "reasoning");
        else if (ev.type === "image") {
          let url: string | null = null;
          try {
            url = ev.data ? await saveBase64Image(ev.data, ev.mime) : ev.url ? await persistRemoteImage(ev.url) : null;
          } catch (e) {
            console.error("[prism] 保存回答里的图片失败", (e as Error)?.message);
          }
          if (await keep(url)) yield sseLine({ url }, "image");
          else yield sseLine({ title: "图片没能保存", text: "模型返回了一张图片，但内容无法识别或保存失败。" }, "notice");
        }
        else if (ev.type === "usage") yield sseLine(ev.usage, "usage");
        else if (ev.type === "finish") yield sseLine({ reason: ev.reason }, "finish");
      }
      const rest = await filter.flush();
      if (rest) yield sseLine({ t: rest }, "text");
      if (saved.length) {
        await addGallery(saved.map((url) => ({ url, prompt, model: body!.model }))).catch((e) =>
          console.error("[prism] 回答里的图片写入图库失败", (e as Error)?.message),
        );
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
