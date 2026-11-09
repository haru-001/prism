import "server-only";
import { kv, P } from "./kv";
import { randomId } from "./crypto";
import { allDbFileIds, localFileId } from "./files";
import { localizeConversation, localizeGallery } from "./imgurl";
import { defer, settle } from "./defer";
import { recordUsage } from "./stats";
import { clearDetails } from "./logdetail";
import type { ReqCtx } from "./relay/capture";
import type {
  ChatMsg,
  Channel,
  Conversation,
  ConversationMeta,
  GalleryItem,
  LogEntry,
  Onboarding,
  Settings,
} from "../types";

// ===== 渠道 =====
/** fresh=true 时跳过内存缓存直接读库：所有「先读后写」的地方都用它 */
export async function listChannels(opts?: { fresh?: boolean }): Promise<Channel[]> {
  const arr = (await kv().get<Channel[]>(P + "channels", opts)) || [];
  return arr.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
}

export async function saveChannels(list: Channel[]) {
  await kv().set(P + "channels", list);
}

export async function getChannel(id: string, opts?: { fresh?: boolean }) {
  return (await listChannels(opts)).find((c) => c.id === id) || null;
}

/** base：调用方刚从库里读到的列表（省一次读）；不传就重新读 */
export async function upsertChannel(ch: Channel, base?: Channel[]) {
  const list = base ? base.slice() : await listChannels({ fresh: true });
  const i = list.findIndex((c) => c.id === ch.id);
  ch.updatedAt = Date.now();
  if (i >= 0) list[i] = ch;
  else list.push(ch);
  await saveChannels(list);
  return ch;
}

/** 只更新部分字段（先读后写，尽量缩小并发覆盖的窗口） */
export async function patchChannel(id: string, patch: Partial<Channel> | ((c: Channel) => Partial<Channel>)) {
  const list = await listChannels({ fresh: true });
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const p = typeof patch === "function" ? patch(list[i]) : patch;
  list[i] = { ...list[i], ...p, updatedAt: Date.now() };
  await saveChannels(list);
  return list[i];
}

export async function deleteChannel(id: string) {
  await saveChannels((await listChannels({ fresh: true })).filter((c) => c.id !== id));
}

// ===== 设置 / 引导 =====
export const defaultSettings: Settings = {
  callMode: "you",
  customName: "",
  personaInModel: false,
  defaultSystem: "",
  temperature: 0.7,
};

export async function getSettings(opts?: { fresh?: boolean }): Promise<Settings> {
  return { ...defaultSettings, ...((await kv().get<Partial<Settings>>(P + "settings", opts)) || {}) };
}

export async function saveSettings(s: Partial<Settings>) {
  const cur = await getSettings({ fresh: true });
  const next = { ...cur, ...s };
  await kv().set(P + "settings", next);
  return next;
}

export async function getOnboarding(opts?: { fresh?: boolean }): Promise<Onboarding> {
  return { completed: false, seenTips: [], ...((await kv().get<Partial<Onboarding>>(P + "onboarding", opts)) || {}) };
}

export async function saveOnboarding(o: Partial<Onboarding>) {
  const cur = await getOnboarding({ fresh: true });
  const next = { ...cur, ...o };
  await kv().set(P + "onboarding", next);
  return next;
}

// ===== 对话 =====
export async function listConversations(): Promise<ConversationMeta[]> {
  const all = await kv().hgetall<ConversationMeta>(P + "conv:meta");
  return Object.values(all).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 读出的图片地址一律改写成带签名的本站地址（旧数据里的 Blob 直链、上游链接也在这里改写，不用迁移） */
export async function getConversation(id: string) {
  return localizeConversation(await kv().get<Conversation>(P + "conv:" + id));
}

export async function saveConversation(c: Conversation) {
  const meta: ConversationMeta = {
    id: c.id,
    title: c.title,
    hasImage: c.hasImage,
    model: c.model,
    updatedAt: c.updatedAt,
    createdAt: c.createdAt,
  };
  // 两张表互不依赖，并行写（连接池里的连接会被复用，不会多握手）
  await Promise.all([kv().set(P + "conv:" + c.id, c), kv().hset(P + "conv:meta", c.id, meta)]);
}

/**
 * 只改对话里的一条消息（视频任务在后台完成时把结果写回去）。f 返回 null 表示不用改。
 * 先读后写；用户同时在页面上保存时，以后写的为准，页面那边拿到结果后也会再保存一次。
 */
export async function patchConversationMessage(convId: string, msgId: string, f: (m: ChatMsg) => ChatMsg | null) {
  const c = await kv().get<Conversation>(P + "conv:" + convId);
  if (!c || !Array.isArray(c.messages)) return false;
  const i = c.messages.findIndex((m) => m.id === msgId);
  if (i < 0) return false;
  const next = f(c.messages[i]);
  if (!next) return false;
  c.messages[i] = next;
  c.updatedAt = Date.now();
  await saveConversation(c);
  return true;
}

export async function deleteConversation(id: string) {
  await Promise.all([kv().del(P + "conv:" + id), kv().hdel(P + "conv:meta", id)]);
}

// ===== 图库 =====
export async function addGallery(items: Omit<GalleryItem, "id" | "createdAt">[]) {
  const out: GalleryItem[] = [];
  for (const it of items) {
    const g: GalleryItem = { ...it, id: randomId(), createdAt: Date.now() };
    await kv().lpush(P + "gallery", g, 2000);
    out.push(g);
  }
  return out;
}

export async function listGallery(): Promise<GalleryItem[]> {
  // 三个读取互不依赖：一起发出去，只等一个往返（隐藏列表一般直接命中内存缓存）
  const [arr, hiddenArr, alive] = await Promise.all([
    kv().lrange<GalleryItem>(P + "gallery", 0, 1999),
    kv().get<string[]>(P + "gallery:hidden"),
    allDbFileIds(),
  ]);
  const hidden = new Set(hiddenArr || []);
  const visible = localizeGallery(arr.filter((x) => !hidden.has(x.id)));
  // 图片存在 MySQL 里时，超出总量上限的旧图会被清理，图库里不再显示它们
  if (!alive) return visible;
  return visible.filter((x) => {
    const id = localFileId(x.url);
    return !id || alive.has(id);
  });
}

export async function hideGallery(id: string) {
  const hidden = (await kv().get<string[]>(P + "gallery:hidden", { fresh: true })) || [];
  hidden.push(id);
  await kv().set(P + "gallery:hidden", hidden.slice(-2000));
}

// ===== 日志 =====
export const LOG_LIMIT = 500;

/** 写请求日志不再拖住响应：交给后台写，立刻返回（at 取调用时刻，排序不受影响） */
/**
 * 写一条日志，同时记一笔用量统计。两者都在响应发出后才在后台写库，不占请求时间。
 * ctx：这次请求的上下文（日志 id、令牌）；有 ctx 的请求还会另存一份完整的请求/响应详情。
 */
export async function addLog(e: Omit<LogEntry, "id" | "at">, ctx?: ReqCtx) {
  const entry: LogEntry = { ...e, id: ctx?.logId || randomId(), at: Date.now() };
  if (ctx) {
    // 同一个请求只算一条日志（理论上不会重复，防御一下）
    if (ctx.logged) entry.id = randomId();
    else entry.detail = true;
    ctx.logged = true;
    if (ctx.replayOf) entry.replayOf = ctx.replayOf;
    if (ctx.token) {
      entry.tokenId = ctx.token.id;
      entry.tokenName = ctx.token.name;
    }
  }
  defer(() => kv().lpush(P + "logs", entry, LOG_LIMIT), "写日志");
  defer(() => recordUsage(entry), "记用量");
}

export async function listLogs(): Promise<LogEntry[]> {
  await settle();
  return kv().lrange<LogEntry>(P + "logs", 0, LOG_LIMIT - 1);
}

export async function clearLogs() {
  await settle();
  await kv().del(P + "logs");
  await clearDetails();
}
