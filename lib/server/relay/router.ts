import "server-only";
import type { Channel, IChatEvent, IChatRequest, IUsage, LogEntry, ModelGroup } from "../../types";
import { guessCaps } from "../../models";
import { copy, fill } from "../../copy";
import { addLog, listChannels, patchChannel } from "../store";
import { resolveImage } from "../files";
import { RelayError, toRelayError } from "./errors";
import { makeTarget, type Target } from "./target";

export const TIMEOUT_STREAK_LIMIT = 3;

export interface Notice {
  kind: "failover" | "disabled";
  text: string;
}

/** 渠道对外暴露的模型：启用的模型 + 别名 */
export function exposedModels(ch: Channel): { id: string; upstream: string }[] {
  const out = new Map<string, string>();
  for (const m of ch.models) out.set(m, ch.mapping[m] || m);
  for (const [alias, up] of Object.entries(ch.mapping)) if (alias && up) out.set(alias, up);
  return [...out.entries()].map(([id, upstream]) => ({ id, upstream }));
}

export function capsFor(ch: Channel, id: string, upstream: string) {
  return ch.caps[id] || ch.caps[upstream] || guessCaps(upstream);
}

export function buildCatalog(channels: Channel[], includeDisabled = true): ModelGroup[] {
  return channels
    .filter((c) => includeDisabled || (c.enabled && !c.autoDisabled))
    .map((c) => ({
      channelId: c.id,
      channelName: c.name,
      type: c.type,
      disabled: !c.enabled || !!c.autoDisabled,
      reason: c.autoDisabled ? c.disabledReason || "线路超时" : !c.enabled ? "已停用" : undefined,
      models: exposedModels(c).map((m) => ({ id: m.id, upstream: m.upstream, caps: capsFor(c, m.id, m.upstream) })),
    }));
}

/** 找出能提供该模型的线路，按优先级排序；同优先级随机打散 */
export async function targetsFor(model: string, preferChannelId?: string): Promise<Target[]> {
  const name = model.replace(/^models\//, "");
  const channels = (await listChannels()).filter((c) => c.enabled && !c.autoDisabled);
  const hits: { ch: Channel; upstream: string; r: number }[] = [];
  for (const ch of channels) {
    const m = exposedModels(ch).find((x) => x.id === name);
    if (m) hits.push({ ch, upstream: m.upstream, r: Math.random() });
  }
  hits.sort((a, b) => {
    if (preferChannelId) {
      if (a.ch.id === preferChannelId && b.ch.id !== preferChannelId) return -1;
      if (b.ch.id === preferChannelId && a.ch.id !== preferChannelId) return 1;
    }
    return a.ch.priority - b.ch.priority || a.r - b.r;
  });
  return hits.map((h) => makeTarget(h.ch, h.upstream));
}

async function markSuccess(t: Target, latencyMs: number) {
  const ch = t.channel;
  if (ch.timeoutStreak > 0 || !ch.status?.ok) {
    await patchChannel(ch.id, { timeoutStreak: 0, status: { ok: true, latencyMs, at: Date.now() } });
  }
}

/** 记录失败；连续超时达到上限时自动停用，返回是否刚被停用 */
async function markFailure(t: Target, err: RelayError): Promise<boolean> {
  const isTimeout = err.kind === "timeout" || err.kind === "network";
  let disabled = false;
  await patchChannel(t.channel.id, (c) => {
    const streak = isTimeout ? (c.timeoutStreak || 0) + 1 : c.timeoutStreak || 0;
    const p: Partial<Channel> = {
      timeoutStreak: streak,
      status: { ok: false, message: err.message.slice(0, 200), at: Date.now() },
    };
    if (isTimeout && streak >= TIMEOUT_STREAK_LIMIT && !c.autoDisabled) {
      p.autoDisabled = true;
      p.disabledReason = `连续 ${streak} 次超时，已自动停用`;
      disabled = true;
    }
    return p;
  });
  return disabled;
}

export interface Routed<T> {
  value: T;
  target: Target;
  attempts: number;
  notices: Notice[];
  startedAt: number;
}

export type FailoverError = RelayError & { attempts?: number; notices?: Notice[] };

/**
 * 按优先级逐条尝试，失败自动换下一条。
 * fn 只需要在拿到上游响应头之前抛错，流式正文开始之后就不再切换。
 */
export async function withFailover<T>(
  model: string,
  fn: (t: Target) => Promise<T>,
  opts: { prefer?: string } = {},
): Promise<Routed<T>> {
  const startedAt = Date.now();
  const targets = await targetsFor(model, opts.prefer);
  if (!targets.length) {
    const e: FailoverError = new RelayError("nochannel", `没有可用的线路提供模型 ${model}`, 503);
    e.attempts = 0;
    e.notices = [];
    throw e;
  }
  const notices: Notice[] = [];
  let last: RelayError | null = null;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const t0 = Date.now();
    try {
      const value = await fn(t);
      void markSuccess(t, Date.now() - t0).catch(() => {});
      return { value, target: t, attempts: i + 1, notices, startedAt };
    } catch (e) {
      const err = toRelayError(e, t.channel.name);
      last = err;
      if (err.kind === "unsupported" && targets.length === 1) break;
      // 客户端自己断开的不算线路的错
      if ((e as Error)?.name === "AbortError" && err.kind !== "timeout") break;
      const disabled = await markFailure(t, err).catch(() => false);
      if (disabled)
        notices.push({
          kind: "disabled",
          text: fill(copy.chat.autoDisabled, { channel: t.channel.name, n: TIMEOUT_STREAK_LIMIT }),
        });
      const next = targets[i + 1];
      if (next)
        notices.push({ kind: "failover", text: fill(copy.chat.failover, { from: t.channel.name, to: next.channel.name }) });
    }
  }
  const e = (last || new RelayError("network", "所有线路都失败了")) as FailoverError;
  e.attempts = targets.length;
  e.notices = notices;
  throw e;
}

/** 把请求里的图片地址统一转成 base64，只做一次 */
export async function inlineImages(req: IChatRequest): Promise<IChatRequest> {
  const messages = await Promise.all(
    req.messages.map(async (m) => ({
      ...m,
      content: await Promise.all(
        m.content.map(async (p) => {
          if (p.type !== "image" || p.data || !p.url) return p;
          const r = await resolveImage(p.url);
          return { type: "image" as const, data: r.data, mime: r.mime };
        }),
      ),
    })),
  );
  return { ...req, messages };
}

/** 包一层事件流：结束时写请求日志 */
export async function* withLogging(
  events: AsyncGenerator<IChatEvent>,
  meta: { source: LogEntry["source"]; model: string; target: Target; attempts: number; startedAt: number; stream: boolean },
  onUsage?: (u: IUsage) => void,
): AsyncGenerator<IChatEvent> {
  let ttfb: number | undefined;
  let usage: IUsage | undefined;
  let error: string | undefined;
  let chars = 0;
  try {
    for await (const ev of events) {
      if (ttfb == null && (ev.type === "text" || ev.type === "reasoning")) ttfb = Date.now() - meta.startedAt;
      if (ev.type === "text") chars += ev.text.length;
      if (ev.type === "usage") {
        usage = ev.usage;
        onUsage?.(ev.usage);
      }
      yield ev;
    }
  } catch (e) {
    error = (e as Error)?.message || String(e);
    throw e;
  } finally {
    await addLog({
      source: meta.source,
      model: meta.model,
      upstreamModel: meta.target.upstreamModel,
      channel: meta.target.channel.name,
      ok: !error,
      latencyMs: Date.now() - meta.startedAt,
      ttfbMs: ttfb,
      inTokens: usage?.input,
      outTokens: usage?.output ?? (chars ? Math.ceil(chars / 3) : undefined),
      stream: meta.stream,
      attempts: meta.attempts,
      error,
    });
  }
}

export async function logFailure(source: LogEntry["source"], model: string, e: unknown, startedAt: number, stream?: boolean) {
  const err = e as FailoverError;
  await addLog({
    source,
    model,
    channel: err.channel,
    ok: false,
    status: err instanceof RelayError ? err.httpStatus : 500,
    latencyMs: Date.now() - startedAt,
    attempts: err.attempts ?? 1,
    stream,
    error: err?.message || String(e),
  });
}
