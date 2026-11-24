import "server-only";
import { kv, P } from "./kv";
import { randomId } from "./crypto";
import type { PromptDoc, SavedPrompt, UserPrompt } from "../prompts/types";

/** 用户自己的提示词和收藏：整份存一个键（和提示词预设一样，增删改在前端做完整体保存） */
const KEY = P + "prompts";

export async function getPromptDoc(): Promise<PromptDoc> {
  const d = await kv().get<Partial<PromptDoc>>(KEY, { fresh: true });
  return { items: Array.isArray(d?.items) ? d!.items : [], favs: Array.isArray(d?.favs) ? d!.favs : [] };
}

const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
const RATIO = /^\d{1,2}:\d{1,2}$/;

export function normalizeItems(input: unknown): UserPrompt[] {
  const out: UserPrompt[] = [];
  const seen = new Set<string>();
  const now = Date.now();
  for (const x of Array.isArray(input) ? (input as Record<string, unknown>[]) : []) {
    const prompt = str(x?.prompt, 12000).trim();
    if (!prompt) continue;
    let id = str(x?.id, 24).replace(/[^\w-]/g, "") || randomId(10);
    if (seen.has(id)) id = randomId(10);
    seen.add(id);
    const p: UserPrompt = {
      id,
      title: str(x?.title, 60).trim() || prompt.replace(/\s+/g, " ").slice(0, 24),
      prompt,
      createdAt: Number(x?.createdAt) || now,
      updatedAt: Number(x?.updatedAt) || now,
    };
    const cat = str(x?.category, 20).trim();
    if (cat) p.category = cat;
    const ratio = str(x?.ratio, 6);
    if (RATIO.test(ratio)) p.ratio = ratio;
    const cover = str(x?.cover, 600);
    if (cover.startsWith("/api/files/")) p.cover = cover;
    out.push(p);
  }
  return out.slice(0, 1000);
}

export function normalizeFavs(input: unknown): SavedPrompt[] {
  const out: SavedPrompt[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(input) ? (input as Record<string, unknown>[]) : []) {
    const key = str(x?.key, 80);
    const src = str(x?.src, 4) as SavedPrompt["src"];
    const text = str(x?.text, 12000);
    if (!key || seen.has(key) || !["sx", "my", "r18", "as"].includes(src) || !text) continue;
    seen.add(key);
    const f: SavedPrompt = { key, src, title: str(x?.title, 120), text, time: Number(x?.time) || Date.now() };
    const img = str(x?.img, 300);
    if (img) f.img = img;
    const ratio = str(x?.ratio, 6);
    if (RATIO.test(ratio)) f.ratio = ratio;
    out.push(f);
  }
  return out.slice(0, 2000);
}

/** 只改传进来的部分（items 或 favs 整体替换），另一部分以库里为准 */
export async function savePromptDoc(patch: { items?: unknown; favs?: unknown }): Promise<PromptDoc> {
  const cur = await getPromptDoc();
  const next: PromptDoc = {
    items: patch.items !== undefined ? normalizeItems(patch.items) : cur.items,
    favs: patch.favs !== undefined ? normalizeFavs(patch.favs) : cur.favs,
  };
  await kv().set(KEY, next);
  return next;
}
