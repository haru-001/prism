import "server-only";
import type { IChatEvent, IChatRequest, IImageRequest, IImageResult } from "../../../types";
import { RelayError } from "../errors";
import { familyOf, type Target } from "../target";
import { openaiChat, openaiImage, openaiListModels } from "./openai";
import { claudeChat, claudeListModels } from "./claude";
import { geminiChat, geminiImage, geminiListModels } from "./gemini";

/** 每家厂商一个适配器，内部统一用 IChatRequest / IChatEvent */
export function adapterChat(t: Target, req: IChatRequest, signal?: AbortSignal): Promise<AsyncGenerator<IChatEvent>> {
  switch (familyOf(t.channel.type)) {
    case "claude":
      return claudeChat(t, req, signal);
    case "gemini":
      return geminiChat(t, req, signal);
    default:
      return openaiChat(t, req, signal);
  }
}

export function adapterListModels(t: Target): Promise<string[]> {
  switch (familyOf(t.channel.type)) {
    case "claude":
      return claudeListModels(t);
    case "gemini":
      return geminiListModels(t);
    default:
      return openaiListModels(t);
  }
}

export async function adapterImage(t: Target, req: IImageRequest, signal?: AbortSignal): Promise<IImageResult[]> {
  switch (familyOf(t.channel.type)) {
    case "claude":
      throw new RelayError("unsupported", "Claude 渠道不支持生图", 400, t.channel.name);
    case "gemini":
      return geminiImage(t, req, signal);
    default:
      return openaiImage(t, req, signal);
  }
}
