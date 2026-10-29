import "server-only";
import type { Channel } from "../../types";
import { normalizeBaseUrl } from "../../models";
import { decrypt } from "../crypto";

/** 一次请求要打到的具体线路 */
export interface Target {
  channel: Channel;
  key: string;
  base: string;
  upstreamModel: string;
}

export function makeTarget(channel: Channel, upstreamModel: string): Target {
  return {
    channel,
    key: decrypt(channel.keyEnc),
    base: normalizeBaseUrl(channel.type, channel.baseUrl),
    upstreamModel,
  };
}

export type Family = "openai" | "claude" | "gemini";

export function familyOf(type: Channel["type"]): Family {
  if (type === "claude") return "claude";
  if (type === "gemini") return "gemini";
  return "openai";
}
