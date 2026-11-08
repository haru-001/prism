import "server-only";
import { kv, P } from "../kv";
import { decrypt, encrypt, maskKey } from "../crypto";
import { DEFAULT_HF_SPACE, isSpaceName, isToolName, presetById, type VideoMode, type VideoProvider } from "../../video";

/**
 * 视频服务的配置：两家的 Key（加密）和默认选择。存在 prism:video:cfg 一个键里。
 * Key 只在服务端解密，接口只返回打码后的提示（hf_••••a9c）。
 */
interface KeyRec {
  enc: string;
  hint: string;
  addedAt: number;
  /** 最近一次「测试连接」的结果 */
  test?: { ok: boolean; message: string; at: number };
}

export interface VideoConfig {
  keys: Partial<Record<VideoProvider, KeyRec>>;
  provider: VideoProvider;
  /** HF 每个模式用哪个 Space：预设 id，或 custom:owner/name[#tool] */
  hfSpace: Record<VideoMode, string>;
}

export interface PublicVideoConfig {
  keys: Partial<Record<VideoProvider, { hint: string; addedAt: number; test?: KeyRec["test"] }>>;
  provider: VideoProvider;
  hfSpace: Record<VideoMode, string>;
}

const KEY = P + "video:cfg";

const DEFAULT: VideoConfig = { keys: {}, provider: "hf", hfSpace: { ...DEFAULT_HF_SPACE } };

export async function getVideoConfig(): Promise<VideoConfig> {
  const v = await kv().get<Partial<VideoConfig>>(KEY);
  return { ...DEFAULT, ...(v || {}), keys: { ...(v?.keys || {}) }, hfSpace: { ...DEFAULT.hfSpace, ...(v?.hfSpace || {}) } };
}

async function save(c: VideoConfig) {
  await kv().set(KEY, c);
}

export function toPublicVideo(c: VideoConfig): PublicVideoConfig {
  const keys: PublicVideoConfig["keys"] = {};
  for (const [p, r] of Object.entries(c.keys) as [VideoProvider, KeyRec][]) if (r) keys[p] = { hint: r.hint, addedAt: r.addedAt, test: r.test };
  return { keys, provider: c.provider, hfSpace: c.hfSpace };
}

/** 取明文 Key；没有或解不开（换过 PRISM_SECRET）时返回空串 */
export async function videoKey(p: VideoProvider): Promise<string> {
  const r = (await getVideoConfig()).keys[p];
  if (!r) return "";
  try {
    return decrypt(r.enc);
  } catch {
    return "";
  }
}

/** Key 的基本格式检查：去掉空白；HF 令牌以 hf_ 开头；长度合理 */
export function checkKey(p: VideoProvider, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const k = raw.trim();
  if (k.length < 8 || k.length > 400 || /\s/.test(k)) return null;
  if (p === "hf" && !/^hf_[A-Za-z0-9]{10,}$/.test(k)) return null;
  return k;
}

export async function setVideoKey(p: VideoProvider, key: string) {
  const c = await getVideoConfig();
  c.keys[p] = { enc: encrypt(key), hint: maskKey(key), addedAt: Date.now() };
  // 刚加 Key 的服务顺手设成默认（另一家还没 Key 时）
  const other = p === "hf" ? "zhipu" : "hf";
  if (!c.keys[other]) c.provider = p;
  await save(c);
  return c;
}

export async function deleteVideoKey(p: VideoProvider) {
  const c = await getVideoConfig();
  delete c.keys[p];
  await save(c);
  return c;
}

export async function recordTest(p: VideoProvider, ok: boolean, message: string) {
  const c = await getVideoConfig();
  const r = c.keys[p];
  if (!r) return c;
  r.test = { ok, message: message.slice(0, 300), at: Date.now() };
  await save(c);
  return c;
}

/** 校验并保存默认服务和各模式的 Space；不合法的值直接忽略 */
export async function setVideoDefaults(b: { provider?: unknown; hfSpace?: Partial<Record<VideoMode, unknown>> }) {
  const c = await getVideoConfig();
  if (b.provider === "hf" || b.provider === "zhipu") c.provider = b.provider;
  for (const m of ["t2v", "i2v", "flf"] as VideoMode[]) {
    const v = b.hfSpace?.[m];
    if (typeof v !== "string") continue;
    const ok = validSpaceChoice(v, m);
    if (ok) c.hfSpace[m] = ok;
  }
  await save(c);
  return c;
}

/** 预设 id（且模式对得上），或 custom:owner/name[#tool]；返回规范化后的值，不合法返回 null */
export function validSpaceChoice(v: string, m: VideoMode): string | null {
  const p = presetById(v);
  if (p) return p.mode === m ? p.id : null;
  if (!v.startsWith("custom:")) return null;
  const [space, tool, ...rest] = v.slice(7).split("#");
  if (rest.length || !isSpaceName(space)) return null;
  if (tool && !isToolName(tool)) return null;
  return "custom:" + space + (tool ? "#" + tool : "");
}
