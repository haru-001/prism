import "server-only";
import { kv, P } from "./kv";
import { randomId } from "./crypto";
import type {
  Channel,
  Conversation,
  ConversationMeta,
  GalleryItem,
  LogEntry,
  Onboarding,
  Settings,
} from "../types";

// ===== 渠道 =====
export async function listChannels(): Promise<Channel[]> {
  const arr = (await kv().get<Channel[]>(P + "channels")) || [];
  return arr.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
}

export async function saveChannels(list: Channel[]) {
  await kv().set(P + "channels", list);
}

export async function getChannel(id: string) {
  return (await listChannels()).find((c) => c.id === id) || null;
}

export async function upsertChannel(ch: Channel) {
  const list = await listChannels();
  const i = list.findIndex((c) => c.id === ch.id);
  ch.updatedAt = Date.now();
  if (i >= 0) list[i] = ch;
  else list.push(ch);
  await saveChannels(list);
  return ch;
}

/** 只更新部分字段（先读后写，尽量缩小并发覆盖的窗口） */
export async function patchChannel(id: string, patch: Partial<Channel> | ((c: Channel) => Partial<Channel>)) {
  const list = await listChannels();
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const p = typeof patch === "function" ? patch(list[i]) : patch;
  list[i] = { ...list[i], ...p, updatedAt: Date.now() };
  await saveChannels(list);
  return list[i];
}

export async function deleteChannel(id: string) {
  await saveChannels((await listChannels()).filter((c) => c.id !== id));
}

// ===== 设置 / 引导 =====
export const defaultSettings: Settings = {
  callMode: "you",
  customName: "",
  personaInModel: false,
  defaultSystem: "",
  temperature: 0.7,
};

export async function getSettings(): Promise<Settings> {
  return { ...defaultSettings, ...((await kv().get<Partial<Settings>>(P + "settings")) || {}) };
}

export async function saveSettings(s: Partial<Settings>) {
  const cur = await getSettings();
  const next = { ...cur, ...s };
  await kv().set(P + "settings", next);
  return next;
}

export async function getOnboarding(): Promise<Onboarding> {
  return { completed: false, seenTips: [], ...((await kv().get<Partial<Onboarding>>(P + "onboarding")) || {}) };
}

export async function saveOnboarding(o: Partial<Onboarding>) {
  const cur = await getOnboarding();
  const next = { ...cur, ...o };
  await kv().set(P + "onboarding", next);
  return next;
}

// ===== 对话 =====
export async function listConversations(): Promise<ConversationMeta[]> {
  const all = await kv().hgetall<ConversationMeta>(P + "conv:meta");
  return Object.values(all).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getConversation(id: string) {
  return kv().get<Conversation>(P + "conv:" + id);
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
  await kv().set(P + "conv:" + c.id, c);
  await kv().hset(P + "conv:meta", c.id, meta);
}

export async function deleteConversation(id: string) {
  await kv().del(P + "conv:" + id);
  await kv().hdel(P + "conv:meta", id);
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
  const arr = await kv().lrange<GalleryItem>(P + "gallery", 0, 1999);
  const hidden = (await kv().get<string[]>(P + "gallery:hidden")) || [];
  return arr.filter((x) => !hidden.includes(x.id));
}

export async function hideGallery(id: string) {
  const hidden = (await kv().get<string[]>(P + "gallery:hidden")) || [];
  hidden.push(id);
  await kv().set(P + "gallery:hidden", hidden.slice(-2000));
}

// ===== 日志 =====
export const LOG_LIMIT = 500;

export async function addLog(e: Omit<LogEntry, "id" | "at">) {
  try {
    await kv().lpush(P + "logs", { ...e, id: randomId(), at: Date.now() }, LOG_LIMIT);
  } catch (err) {
    console.error("[prism] 写日志失败", err);
  }
}

export async function listLogs(): Promise<LogEntry[]> {
  return kv().lrange<LogEntry>(P + "logs", 0, LOG_LIMIT - 1);
}

export async function clearLogs() {
  await kv().del(P + "logs");
}
