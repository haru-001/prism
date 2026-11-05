import "server-only";
import { kv, P } from "./kv";
import { randomId } from "./crypto";
import type { Preset } from "../types";

/** 提示词预设：整份列表存一个键（在内存缓存里，读取不查库） */
export async function listPresets(opts?: { fresh?: boolean }): Promise<Preset[]> {
  return (await kv().get<Preset[]>(P + "presets", opts)) || [];
}

export function normalizePresets(input: unknown): Preset[] {
  const out: Preset[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(input) ? input : []) {
    const name = String(x?.name || "").trim().slice(0, 30);
    const system = String(x?.system || "").slice(0, 8000);
    if (!name || !system.trim()) continue;
    let id = String(x?.id || "").replace(/[^\w-]/g, "").slice(0, 24) || randomId(8);
    if (seen.has(id)) id = randomId(8);
    seen.add(id);
    const p: Preset = { id, name, system };
    const t = Number(x?.temperature);
    if (x?.temperature != null && x?.temperature !== "" && Number.isFinite(t)) p.temperature = Math.min(2, Math.max(0, t));
    out.push(p);
  }
  return out.slice(0, 100);
}

export async function savePresets(list: Preset[]) {
  await kv().set(P + "presets", list);
}
