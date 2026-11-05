import "server-only";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { kv, P } from "./kv";
import { decrypt } from "./crypto";
import { localizeConversation } from "./imgurl";
import { getSettings, listChannels, listConversations, saveChannels, saveConversation, saveSettings } from "./store";
import { listTokens, mergeTokens } from "./tokens";
import { getPricing, normalizePricing, savePricing } from "./stats";
import { listPresets, normalizePresets, savePresets } from "./presets";
import type { Channel, Conversation, Preset, Pricing, Settings, TokenRecord } from "../types";

/**
 * 一键备份 / 恢复
 * - 导出：渠道、设置（含提示词预设和模型单价）、令牌、会话 → JSON → gzip → 用备份密码做 AES-256-GCM 加密
 * - 上游 Key 在文件里仍是 PRISM_SECRET 加密后的样子（双重加密），换了 PRISM_SECRET 的部署解不开这些 Key，预览时会标出来
 * - 恢复前先预览：哪些会被覆盖、哪些是新增、哪些保持不动
 * - 恢复按「同 ID 覆盖、其余保留」合并，不会删掉备份里没有的东西
 * - 图片文件本身不在备份里（会话里只有图片链接）
 */

export const SECTIONS = ["channels", "settings", "tokens", "conversations"] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABEL: Record<Section, string> = { channels: "渠道", settings: "设置", tokens: "令牌", conversations: "会话" };

export interface BackupData {
  app: "prism";
  version: 1;
  createdAt: number;
  sections: Section[];
  channels?: Channel[];
  settings?: { settings: Settings; presets: Preset[]; pricing: Pricing };
  tokens?: TokenRecord[];
  conversations?: Conversation[];
}

interface Envelope {
  format: "prism-backup";
  version: 1;
  createdAt: number;
  kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string };
  iv: string;
  tag: string;
  data: string;
}

export class BackupError extends Error {}

const KDF = { N: 16384, r: 8, p: 1 };

function deriveKey(password: string, salt: Buffer, k = KDF) {
  return crypto.scryptSync(password, salt, 32, { N: k.N, r: k.r, p: k.p, maxmem: 64 * 1024 * 1024 });
}

export function checkBackupPassword(pw: unknown): string {
  const s = typeof pw === "string" ? pw : "";
  if (s.length < 6) throw new BackupError("备份密码至少 6 位");
  return s;
}

export function sealBackup(data: BackupData, password: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const packed = zlib.gzipSync(Buffer.from(JSON.stringify(data), "utf8"));
  const ct = Buffer.concat([c.update(packed), c.final()]);
  const env: Envelope = {
    format: "prism-backup",
    version: 1,
    createdAt: data.createdAt,
    kdf: { name: "scrypt", ...KDF, salt: salt.toString("base64") },
    iv: iv.toString("base64"),
    tag: c.getAuthTag().toString("base64"),
    data: ct.toString("base64"),
  };
  return JSON.stringify(env);
}

export function openBackup(file: string, password: string): BackupData {
  let env: Envelope;
  try {
    env = JSON.parse(file);
  } catch {
    throw new BackupError("这不是 Prism 的备份文件（格式不对）");
  }
  if (env?.format !== "prism-backup" || !env.kdf?.salt || !env.iv || !env.tag || !env.data) throw new BackupError("这不是 Prism 的备份文件（格式不对）");
  if (env.version !== 1) throw new BackupError(`备份文件版本 ${env.version} 太新，先把 Prism 升级到最新版再恢复`);
  const k = { N: Number(env.kdf.N) || KDF.N, r: Number(env.kdf.r) || KDF.r, p: Number(env.kdf.p) || KDF.p };
  if (k.N > 1 << 17 || k.r > 16 || k.p > 4) throw new BackupError("备份文件的加密参数不对");
  let plain: Buffer;
  try {
    const key = deriveKey(password, Buffer.from(env.kdf.salt, "base64"), k);
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
    d.setAuthTag(Buffer.from(env.tag, "base64"));
    plain = Buffer.concat([d.update(Buffer.from(env.data, "base64")), d.final()]);
  } catch {
    throw new BackupError("备份密码不对，或者文件已损坏");
  }
  let data: BackupData;
  try {
    data = JSON.parse(zlib.gunzipSync(plain).toString("utf8"));
  } catch {
    throw new BackupError("备份文件已损坏，读不出内容");
  }
  if (data?.app !== "prism") throw new BackupError("这不是 Prism 的备份文件");
  return data;
}

async function allConversations(): Promise<Conversation[]> {
  const metas = await listConversations();
  const out: Conversation[] = [];
  for (let i = 0; i < metas.length; i += 100) {
    const keys = metas.slice(i, i + 100).map((m) => P + "conv:" + m.id);
    const rows = await kv().mget(keys, { fresh: true });
    for (const k of keys) if (rows[k]) out.push(localizeConversation(rows[k] as Conversation));
  }
  return out;
}

export async function collectBackup(sections: Section[]): Promise<BackupData> {
  const want = new Set(sections);
  const data: BackupData = { app: "prism", version: 1, createdAt: Date.now(), sections: SECTIONS.filter((s) => want.has(s)) };
  await Promise.all([
    want.has("channels") && listChannels({ fresh: true }).then((v) => (data.channels = v)),
    want.has("settings") &&
      Promise.all([getSettings({ fresh: true }), listPresets({ fresh: true }), getPricing({ fresh: true })]).then(
        ([settings, presets, pricing]) => (data.settings = { settings, presets, pricing }),
      ),
    want.has("tokens") && listTokens({ fresh: true }).then((v) => (data.tokens = v)),
    want.has("conversations") && allConversations().then((v) => (data.conversations = v)),
  ]);
  return data;
}

export function parseSections(v: unknown): Section[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const s = SECTIONS.filter((x) => arr.includes(x));
  return s;
}

// ===== 预览 =====

const SETTING_LABEL: Record<string, string> = {
  callMode: "称呼方式",
  customName: "自定义称呼",
  personaInModel: "让模型也用棱音的口吻",
  defaultModel: "默认模型",
  defaultImageModel: "默认生图模型",
  defaultSystem: "默认系统提示词",
  temperature: "默认温度",
  rinneOutfit: "棱音的服装",
  rinneMotion: "换装动效",
  rinneShow: "显示棱音",
};
function show(v: unknown) {
  if (v === undefined || v === null || v === "") return "（空）";
  if (typeof v === "boolean") return v ? "开" : "关";
  const s = String(v);
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}

function splitById<T extends { id: string }>(incoming: T[], current: T[], name: (t: T) => string) {
  const cur = new Map(current.map((c) => [c.id, c]));
  const inc = new Set(incoming.map((i) => i.id));
  return {
    overwrite: incoming.filter((i) => cur.has(i.id)).map((i) => name(i)),
    add: incoming.filter((i) => !cur.has(i.id)).map((i) => name(i)),
    keep: current.filter((c) => !inc.has(c.id)).length,
  };
}

const keyOk = (enc: string) => {
  try {
    decrypt(enc);
    return true;
  } catch {
    return false;
  }
};

export async function previewBackup(data: BackupData) {
  const out: Record<string, unknown> = {};
  const has = (s: Section) => data.sections?.includes(s) && data[s] !== undefined;
  if (has("channels")) {
    const list = (data.channels || []).filter((c) => c?.id);
    out.channels = {
      count: list.length,
      ...splitById(list, await listChannels({ fresh: true }), (c) => c.name),
      keyProblems: list.filter((c) => c.keyEnc && !keyOk(c.keyEnc)).map((c) => c.name),
    };
  }
  if (has("settings")) {
    const cur = await getSettings({ fresh: true });
    const inc = { ...cur, ...(data.settings?.settings || {}) } as Settings;
    const changes = (Object.keys(SETTING_LABEL) as (keyof Settings)[])
      .filter((k) => JSON.stringify(cur[k] ?? "") !== JSON.stringify(inc[k] ?? ""))
      .map((k) => ({ label: SETTING_LABEL[k], from: show(cur[k]), to: show(inc[k]) }));
    const presets = normalizePresets(data.settings?.presets || []);
    const pricing = normalizePricing(data.settings?.pricing || { currency: "$", rules: [] });
    out.settings = {
      changes,
      presets: { count: presets.length, ...splitById(presets, await listPresets({ fresh: true }), (p) => p.name) },
      pricing: { rules: pricing.rules.length, current: (await getPricing({ fresh: true })).rules.length },
    };
  }
  if (has("tokens")) {
    const list = (data.tokens || []).filter((t) => t?.id && typeof t.key === "string");
    const current = await listTokens({ fresh: true });
    const curDef = current.find((t) => t.id === "default");
    const incDef = list.find((t) => t.id === "default");
    out.tokens = {
      count: list.length,
      ...splitById(list, current, (t) => t.name),
      defaultKeyChanges: !!(incDef?.key && curDef && incDef.key !== curDef.key),
    };
  }
  if (has("conversations")) {
    const list = (data.conversations || []).filter((c) => c?.id && Array.isArray(c.messages));
    const s = splitById(list, await listConversations(), (c) => c.title || "新对话");
    out.conversations = { count: list.length, overwrite: s.overwrite, add: s.add.length, addSample: s.add.slice(0, 8), keep: s.keep };
  }
  return { createdAt: data.createdAt, sections: SECTIONS.filter((s) => has(s)), detail: out };
}

// ===== 恢复 =====

export async function restoreBackup(data: BackupData, sections: Section[]) {
  const want = new Set(sections.filter((s) => data.sections?.includes(s)));
  const done: Record<string, number> = {};
  if (want.has("channels") && data.channels) {
    const cur = await listChannels({ fresh: true });
    const map = new Map(cur.map((c) => [c.id, c]));
    for (const c of data.channels) if (c?.id && c.type && typeof c.baseUrl === "string") map.set(c.id, { ...c, updatedAt: Date.now() });
    await saveChannels([...map.values()]);
    done.channels = data.channels.length;
  }
  if (want.has("settings") && data.settings) {
    if (data.settings.settings) {
      const allowed = Object.keys(SETTING_LABEL);
      const s = Object.fromEntries(Object.entries(data.settings.settings).filter(([k]) => allowed.includes(k)));
      await saveSettings(s as Partial<Settings>);
    }
    const incoming = normalizePresets(data.settings.presets || []);
    const cur = await listPresets({ fresh: true });
    const map = new Map(cur.map((p) => [p.id, p]));
    for (const p of incoming) map.set(p.id, p);
    await savePresets([...map.values()]);
    if (data.settings.pricing) await savePricing(normalizePricing(data.settings.pricing));
    done.settings = 1;
  }
  if (want.has("tokens") && data.tokens) {
    await mergeTokens(data.tokens.filter((t) => t?.id && typeof t.key === "string"));
    done.tokens = data.tokens.length;
  }
  if (want.has("conversations") && data.conversations) {
    const list = data.conversations.filter((c) => c?.id && Array.isArray(c.messages));
    // 分批并行写，连接池只有 3 条连接，一次不要堆太多
    for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map((c) => saveConversation(c)));
    done.conversations = list.length;
  }
  return done;
}
