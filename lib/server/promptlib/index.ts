import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { kv, P, storageKind } from "../kv";
import bundled from "../../promptlib-bundled.json";
import { IMG_BASE, SX_BRANCH, SX_DIR, SX_REPO, buildSx, hashParts, sizesFromLists, type SxRaw } from "./build";
import type { LibManifest } from "../../prompts/types";

/**
 * 本地提示词库（水仙的AI提示词 + 可选的 R18 库）：
 * - 随代码发布一份内置数据：水仙库在 public/prompt-lib/sx/<版本>/（静态文件，CDN 直出），
 *   R18 库在 data/prompt-lib/（不放 public，经 /api/prompt-lib/ 登录后才能读）
 * - 「数据更新」从 GitHub 拉最新数据，完整生成、全部存好之后才切换版本；存在数据库（MySQL）或 .data/prompt-lib（本地）
 * - 所有数据文件带版本号，浏览器缓存一年，二次打开不再请求
 */

const MKEY = P + "plib:manifest";
const LOCK = P + "plib:lock";
const fileKey = (ver: string, name: string) => `${P}plib:f:${ver}:${name}`;
const localDir = () => path.join(process.cwd(), ".data", "prompt-lib");

export interface SyncedSx {
  source: "synced" | "bundled";
  ver: string;
  date?: string;
  note?: string;
  count: number;
  chunks: number;
  chunk: number;
  py: boolean;
  dataHash: string;
  syncedAt: string;
  files?: string[];
}
interface Stored {
  sx?: SyncedSx;
}

let memo: { at: number; v: Stored } | null = null;
async function readStored(fresh = false): Promise<Stored> {
  if (!fresh && memo && Date.now() - memo.at < 30_000) return memo.v;
  const v = (await kv().get<Stored>(MKEY, { fresh: true })) || {};
  memo = { at: Date.now(), v };
  return v;
}
async function writeStored(v: Stored) {
  await kv().set(MKEY, v);
  memo = { at: Date.now(), v };
}

/** 下发给浏览器的清单（页面服务端渲染时直接带上，不用再请求一次） */
export async function getLibManifest(): Promise<LibManifest> {
  let st: Stored = {};
  try {
    st = await readStored();
  } catch {
    /* 数据库连不上时用内置数据，提示词库照常能用 */
  }
  const b = bundled.sx;
  const s = st.sx?.source === "synced" ? st.sx : null;
  const sx: LibManifest["sx"] = s
    ? { url: `/api/prompt-lib/d/${s.ver}/`, ver: s.ver, date: s.date, count: s.count, chunks: s.chunks, chunk: s.chunk, py: s.py, source: "synced", syncedAt: s.syncedAt }
    : { url: `/prompt-lib/sx/${b.ver}/`, ver: b.ver, date: b.date, count: b.count, chunks: b.chunks, chunk: b.chunk, py: b.py, source: "bundled", syncedAt: st.sx?.syncedAt };
  return {
    v: sx.ver,
    sx,
    r18: { url: `/api/prompt-lib/r18/`, ver: bundled.r18.ver, count: bundled.r18.count, chunks: bundled.r18.chunks, chunk: bundled.r18.chunk, clothZh: bundled.r18.clothZh },
    as: { url: `/api/prompt-lib/as/`, ver: bundled.as.ver, count: bundled.as.count },
    img: "/api/prompt-lib/img/",
    imgRemote: IMG_BASE,
  };
}

// ===== 文件存取 =====
async function putFile(ver: string, name: string, buf: Buffer) {
  if (storageKind() === "mysql") return kv().set(fileKey(ver, name), buf.toString("base64"));
  const d = path.join(localDir(), ver);
  await fs.mkdir(d, { recursive: true });
  await fs.writeFile(path.join(d, name + ".json.gz"), buf);
}
export async function readSyncedFile(ver: string, name: string): Promise<Buffer | null> {
  if (!/^[0-9a-f]{6,40}$/.test(ver) || !/^(index|py|p\d{1,3})$/.test(name)) return null;
  if (storageKind() === "mysql") {
    const b64 = await kv().get<string>(fileKey(ver, name));
    return b64 ? Buffer.from(b64, "base64") : null;
  }
  try {
    return await fs.readFile(path.join(localDir(), ver, name + ".json.gz"));
  } catch {
    return null;
  }
}
async function dropVersion(ver: string, names: string[]) {
  if (storageKind() === "mysql") {
    for (const n of names) await kv().del(fileKey(ver, n)).catch(() => {});
    return;
  }
  await fs.rm(path.join(localDir(), ver), { recursive: true, force: true }).catch(() => {});
}

/** 内置的 R18 / 亚洲写真数据（data/prompt-lib，不在 public 里） */
export async function readBundledFile(kind: "r18" | "as", name: string): Promise<Buffer | null> {
  const ok = kind === "r18" ? /^p\d{1,2}$/.test(name) : name === "ex";
  if (!ok) return null;
  try {
    return await fs.readFile(path.join(process.cwd(), "data", "prompt-lib", kind, name + ".json.gz"));
  } catch {
    return null;
  }
}

// ===== 上游 =====
const UA = { "User-Agent": `prism-prompt-sync (+https://github.com/${SX_REPO})`, Accept: "application/json, */*" };
/** 国内服务器连 GitHub 慢时可以设 PROMPT_LIB_GITHUB_PROXY（如 https://ghproxy.net/），只用于 raw / git 地址 */
const gh = (u: string) => {
  const p = (process.env.PROMPT_LIB_GITHUB_PROXY || "").trim();
  return p && !u.includes("api.github.com") ? p.replace(/\/+$/, "") + "/" + u : u;
};

async function get(url: string, ms = 60_000): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms), cache: "no-store" });
  } catch (e) {
    const msg = (e as Error).name === "TimeoutError" ? "超时" : (e as Error).message;
    throw new Error(`下载失败（${msg}）：${url.replace(/\?.*$/, "")}`);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw Object.assign(new Error(`下载失败 HTTP ${res.status}：${url.replace(/\?.*$/, "")}`), { status: res.status });
  }
  return Buffer.from(await res.arrayBuffer());
}
const getJSON = async <T,>(url: string, ms?: number): Promise<T> => {
  const b = await get(url, ms);
  try {
    return JSON.parse(b.toString("utf8")) as T;
  } catch {
    throw new Error("返回的不是 JSON：" + url);
  }
};

export interface RemoteVer {
  ver: string;
  date: string;
  note: string;
}

/** 上游最新版本：优先用 GitHub API（能拿到数据目录最后一次提交说明），被限流时读 git 分支 HEAD */
export async function remoteSx(): Promise<RemoteVer> {
  try {
    const list = await getJSON<{ sha: string; commit?: { committer?: { date?: string }; message?: string } }[]>(
      `https://api.github.com/repos/${SX_REPO}/commits?per_page=1&sha=${SX_BRANCH}&path=${SX_DIR}`,
      15_000,
    );
    const c = list[0];
    if (c?.sha) return { ver: c.sha.slice(0, 12), date: c.commit?.committer?.date || "", note: (c.commit?.message || "").split("\n")[0] };
  } catch {
    /* 换 git 协议再试 */
  }
  const refs = (await get(gh(`https://github.com/${SX_REPO}.git/info/refs?service=git-upload-pack`), 15_000)).toString("latin1");
  const m = new RegExp(`([0-9a-f]{40}) refs/heads/${SX_BRANCH}`).exec(refs);
  if (!m) throw new Error("拿不到水仙库的版本号");
  return { ver: m[1].slice(0, 12), date: "", note: "" };
}

export interface SyncStatus {
  local: { source: "bundled" | "synced"; ver: string; date?: string; count: number; syncedAt?: string };
  bundled: { ver: string; date?: string; count: number };
  remote?: RemoteVer;
  update?: boolean;
  error?: string;
}

export async function syncCheck(): Promise<SyncStatus> {
  const m = await getLibManifest();
  const out: SyncStatus = {
    local: { source: m.sx.source, ver: m.sx.ver, date: m.sx.date, count: m.sx.count, syncedAt: m.sx.syncedAt },
    bundled: { ver: bundled.sx.ver, date: bundled.sx.date, count: bundled.sx.count },
  };
  try {
    const st = await readStored(true);
    const localVer = st.sx?.ver || m.sx.ver;
    out.remote = await remoteSx();
    out.update = out.remote.ver !== localVer;
  } catch (e) {
    out.error = (e as Error).message;
  }
  return out;
}

/**
 * 同步：下载 → 生成 → 全部存好 → 切换清单 → 删除旧版本。
 * 任何一步失败都不动现有数据；上游内容没变时只更新版本号。
 */
export async function syncRun(): Promise<{ msg: string; count: number; ver: string; unchanged?: boolean }> {
  const n = await kv().incr(LOCK, 300);
  if (n > 1) throw new Error("已有同步任务在运行，请稍等几分钟再试");
  try {
    const remote = await remoteSx();
    const raw = `https://raw.githubusercontent.com/${SX_REPO}/${remote.ver}/${SX_DIR}/`;
    // 分块文件名：GitHub API 列目录；被限流时按 part1、part2… 逐个探测
    let names: string[] = [];
    try {
      const ls = await getJSON<{ name?: string }[]>(`https://api.github.com/repos/${SX_REPO}/contents/${SX_DIR}?ref=${remote.ver}`, 15_000);
      names = ls.map((f) => f.name || "").filter((x) => /^prompts\.part\d+\.json$/.test(x));
      names.sort((a, b) => parseInt(a.slice(12)) - parseInt(b.slice(12)));
    } catch {
      /* 探测 */
    }
    const bufs: Buffer[] = [];
    if (names.length) {
      for (const f of names) bufs.push(await get(gh(raw + f), 120_000));
    } else {
      for (let i = 1; i <= 30; i++) {
        try {
          bufs.push(await get(gh(raw + `prompts.part${i}.json`), 120_000));
        } catch (e) {
          if ((e as { status?: number }).status === 404 && i > 1) break;
          throw e;
        }
      }
    }
    const dataHash = hashParts(bufs);
    const st = await readStored(true);
    const cur = st.sx;
    const now = new Date().toISOString();
    const curHash = cur?.source === "synced" ? cur.dataHash : bundled.sx.dataHash;
    if (curHash === dataHash) {
      const keep: SyncedSx = cur?.source === "synced" ? { ...cur } : { source: "bundled", ...bundled.sx, syncedAt: now };
      // 内容没变：只记下上游版本号（文件不用重新生成；已同步的数据继续用原来的版本目录）
      await writeStored({ ...st, sx: { ...keep, date: remote.date || keep.date, note: remote.note, syncedAt: now, ...(keep.source === "bundled" ? { ver: remote.ver } : {}) } });
      return { msg: "提示词内容没有变化，已更新版本号", count: keep.count, ver: remote.ver, unchanged: true };
    }
    const [categories, meta, pinyin] = await Promise.all([
      getJSON<Record<string, { major?: string }>>(gh(raw + "categories.json")),
      getJSON<{ hot?: string[]; majors?: { name: string; main?: string }[] }>(gh(raw + "meta.json")),
      getJSON<{ chars?: Record<string, string> }>(gh(raw + "pinyin.json")).catch(() => null),
    ]);
    // 图片尺寸只在上游站点的 list 文件里有（用来给「去生成」带建议比例）；拿不到不影响同步
    const lists: unknown[] = [];
    for (let i = 1; i <= 10; i++) {
      try {
        lists.push(await getJSON(`https://prompt.qqsrc.com/data/list.part${i}.json`, 20_000));
      } catch {
        break;
      }
    }
    const parts = bufs.map((b, i) => {
      try {
        return JSON.parse(b.toString("utf8")) as SxRaw[];
      } catch {
        throw new Error(`prompts.part${i + 1}.json 解析失败，本地数据未改动`);
      }
    });
    const out = buildSx({ parts, categories, meta, pinyin, sizes: sizesFromLists(lists) }, dataHash);
    const ver = remote.ver;
    const fileNames = Object.keys(out.files);
    for (const name of fileNames) await putFile(ver, name, out.files[name]);
    const next: SyncedSx = {
      source: "synced",
      ver,
      date: remote.date,
      note: remote.note,
      count: out.count,
      chunks: out.chunks,
      chunk: 250,
      py: !!out.files.py,
      dataHash,
      syncedAt: now,
      files: fileNames,
    };
    await writeStored({ ...st, sx: next });
    if (cur?.source === "synced" && cur.ver !== ver) await dropVersion(cur.ver, cur.files || []);
    return { msg: `同步完成：${out.count} 条`, count: out.count, ver };
  } finally {
    await kv().del(LOCK).catch(() => {});
  }
}

/** 放弃同步来的数据，回到随代码发布的内置版本 */
export async function syncRevert() {
  const st = await readStored(true);
  const cur = st.sx;
  await writeStored({ ...st, sx: undefined });
  if (cur?.source === "synced") await dropVersion(cur.ver, cur.files || []);
}
