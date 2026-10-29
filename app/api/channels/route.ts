import { guard } from "@/lib/server/auth";
import { listChannels, upsertChannel } from "@/lib/server/store";
import { encrypt, maskKey, randomId } from "@/lib/server/crypto";
import { bad, readJSON, toPublic } from "@/lib/server/api";
import { channelTypeInfo, normalizeBaseUrl } from "@/lib/models";
import type { Channel, ChannelType } from "@/lib/types";

export const dynamic = "force-dynamic";

const TYPES: ChannelType[] = ["openai", "claude", "gemini", "azure", "compatible"];

export async function GET() {
  const g = await guard();
  if (g) return g;
  return Response.json({ channels: (await listChannels()).map(toPublic) });
}

export async function POST(req: Request) {
  const g = await guard();
  if (g) return g;
  const b = await readJSON<Partial<Channel> & { key?: string }>(req);
  if (!b) return bad("请求体不是合法 JSON");
  const rawType = (b.type as string) === "anthropic" ? "claude" : b.type;
  if (rawType && !TYPES.includes(rawType as ChannelType)) return bad(`不支持的渠道类型：${rawType}`);
  const type = (rawType || "compatible") as ChannelType;
  const baseUrl = (b.baseUrl || channelTypeInfo(type).base || "").trim();
  if (!baseUrl || !normalizeBaseUrl(type, baseUrl)) return bad("请填写 Base URL");
  if (/你的资源名/.test(baseUrl)) return bad("请把 Azure 地址里的「你的资源名」换成真实资源名");
  const key = (b.key || "").trim();
  if (!key) return bad("请填写 API Key");
  const list = await listChannels();
  const now = Date.now();
  const ch: Channel = {
    id: randomId(10),
    name: (b.name || "").trim() || `${channelTypeInfo(type).label} ${list.filter((c) => c.type === type).length + 1}`,
    type,
    baseUrl,
    keyEnc: encrypt(key),
    keyHint: maskKey(key),
    allModels: Array.isArray(b.allModels) ? b.allModels : [],
    models: Array.isArray(b.models) ? b.models : [],
    mapping: b.mapping && typeof b.mapping === "object" ? b.mapping : {},
    caps: b.caps && typeof b.caps === "object" ? b.caps : {},
    priority: Number.isFinite(Number(b.priority)) ? Number(b.priority) : 1,
    enabled: b.enabled !== false,
    timeoutStreak: 0,
    timeoutMs: Math.max(5000, Number(b.timeoutMs) || 60000),
    apiVersion: type === "azure" ? b.apiVersion || "2024-10-21" : undefined,
    createdAt: now,
    updatedAt: now,
  };
  await upsertChannel(ch);
  return Response.json({ channel: toPublic(ch) });
}
