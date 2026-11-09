import "server-only";
import { put } from "@vercel/blob";
import { env } from "./env";
import { kv, P, storageKind } from "./kv";
import { randomId } from "./crypto";
import { q, T } from "./mysql";
import type { RowDataPacket } from "mysql2/promise";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { BLOB_PUBLIC_HOST, FILES, localImageUrl, localVideoUrl, verifyImgSig } from "./imgurl";

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/**
 * 保存图片，返回可以直接放进 <img src> 的本站地址（带签名，见 imgurl.ts）：
 * - 配了 Vercel Blob：存 Blob（公开或私有都一样，浏览器只看到 /api/files/b/... 或 /api/files/bp/...）
 * - 用 MySQL（Aiven）：压缩后存进 prism_files 表，总量超过 DB_IMAGES_MAX_MB 时删掉最早的图
 * - 本地开发：存进 .data/kv.json
 * 都由 /api/files/[...path] 在服务端读取后输出，浏览器不会直连任何外部域名。
 */
/**
 * 存上游给的 base64 图片。不少中转站的 b64_json 带着 "data:image/png;base64," 前缀、换行，
 * 或者实际是 JPEG / WebP 却一律标成 PNG；直接 Buffer.from 会把前缀当数据解出来，存下的图就是乱码。
 * 这里先去掉前缀和空白，再按文件头认出真实格式；认不出就当作没有图，交给上层报错。
 */
export async function saveBase64Image(b64: string, mime = "image/png"): Promise<string | null> {
  let s = b64.trim();
  const m = /^data:([^;,]+)?(?:;base64)?,/i.exec(s);
  if (m) {
    if (m[1]) mime = m[1];
    s = s.slice(m[0].length);
  }
  s = s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const buf = Buffer.from(s, "base64");
  const real = sniffImage(buf);
  if (!real) {
    console.error("[prism] 上游返回的 base64 不是图片，已丢弃", buf.subarray(0, 16).toString("hex"));
    return null;
  }
  return saveFile(buf, real || mime);
}

export async function saveFile(buf: Buffer, mime: string, folder = "images"): Promise<string> {
  return localImageUrl(await saveFileRaw(buf, mime, folder));
}

async function saveFileRaw(buf: Buffer, mime: string, folder: string): Promise<string> {
  const id = randomId(16);
  if (env.blobToken) {
    const ext = EXT[mime] || "bin";
    const pathname = `prism/${folder}/${id}.${ext}`;
    if (env.blobAccess === "public") {
      try {
        const r = await put(pathname, buf, { access: "public", contentType: mime, token: env.blobToken });
        return r.url;
      } catch (e) {
        const msg = String((e as Error)?.message || e);
        if (!/private/i.test(msg)) throw e;
        // 存储是私有的，改用 private 再试一次
      }
    }
    await put(pathname, buf, { access: "private", contentType: mime, token: env.blobToken });
    return `/api/files/b/${encodeURIComponent(pathname)}`;
  }
  if (storageKind() === "mysql") {
    const f = await shrinkForDb(buf, mime);
    await q(`INSERT INTO ${T.files} (id, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?)`, [id, f.mime, f.buf.length, f.buf, Date.now()]);
    await evictOldFiles().catch((e) => console.error("[prism] 清理旧图片失败", e));
    return `/api/files/${id}.${EXT[f.mime] || "bin"}`;
  }
  await kv().set(P + "file:" + id, { mime, data: buf.toString("base64") });
  return `/api/files/${id}.${EXT[mime] || "bin"}`;
}

const SHRINK_FROM = 200 * 1024;

/**
 * 存进数据库前压缩：超过 200KB 的 PNG / JPG / WebP 转成 WebP（质量 85，长边不超过 2048），
 * 还超过 DB_IMAGE_MAX_KB 就逐步缩小尺寸。GIF（可能是动图）原样保存。压缩失败时原样保存。
 */
export async function shrinkForDb(buf: Buffer, mime: string): Promise<{ buf: Buffer; mime: string }> {
  if (buf.length <= SHRINK_FROM || mime === "image/gif" || !EXT[mime] || !mime.startsWith("image/")) return { buf, mime };
  try {
    const sharp = (await import("sharp")).default;
    const max = env.imageMaxKB * 1024;
    let best: Buffer | null = null;
    for (const [side, quality] of [
      [2048, 85],
      [1600, 80],
      [1280, 78],
      [1024, 75],
      [768, 70],
    ] as const) {
      const out = await sharp(buf, { failOn: "none" })
        .rotate()
        .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
      best = out;
      if (out.length <= max) break;
    }
    if (best && best.length < buf.length) return { buf: best, mime: "image/webp" };
  } catch (e) {
    console.error("[prism] 图片压缩失败，按原图保存", e);
  }
  return { buf, mime };
}

/** 图片总量超过 DB_IMAGES_MAX_MB 时，从最早的开始删，删到上限的 90% */
export async function evictOldFiles() {
  const cap = env.imagesMaxMB * 1024 * 1024;
  const [{ total }] = await q<RowDataPacket[]>(`SELECT COALESCE(SUM(size), 0) AS total FROM ${T.files}`);
  let over = Number(total) - cap;
  if (over <= 0) return 0;
  over += cap * 0.1;
  const rows = await q<RowDataPacket[]>(`SELECT id, size FROM ${T.files} ORDER BY created_at ASC LIMIT 500`);
  const ids: string[] = [];
  for (const r of rows) {
    if (over <= 0) break;
    ids.push(r.id);
    over -= Number(r.size);
  }
  if (ids.length) {
    for (const id of ids) forget(id);
    await q(`DELETE FROM ${T.files} WHERE id IN (?)`, [ids]);
  }
  return ids.length;
}

/** 站内图片地址 /api/files/{id}.{ext} 里的 id；Blob、外链代理和外链返回 null */
export function localFileId(url: string): string | null {
  if (!url.startsWith(FILES) || /^\/api\/files\/(b|bp|ext|vext)([/?]|$)/.test(url)) return null;
  return url.slice(FILES.length).split(/[.?]/)[0] || null;
}

/** 在 MySQL 里还存在的图片 id（被清理掉的不在其中） */
export async function existingFileIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length || storageKind() !== "mysql") return new Set(ids);
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await q<RowDataPacket[]>(`SELECT id FROM ${T.files} WHERE id IN (?)`, [ids.slice(i, i + 500)]);
    for (const r of rows) out.add(r.id);
  }
  return out;
}

/** 所有存在 MySQL 里的图片 id（只读 id 列，不读图片数据）；不是 MySQL 存储时返回 null */
export async function allDbFileIds(): Promise<Set<string> | null> {
  if (storageKind() !== "mysql") return null;
  const rows = await q<RowDataPacket[]>(`SELECT id FROM ${T.files}`);
  return new Set(rows.map((r) => r.id as string));
}

/**
 * 图片内容写入后永远不变：每个实例在内存里留最近读过的图（最多约 24MB），
 * 同一张图再次打开时不用再查库（线上还有 CDN 缓存挡在前面）。图被自动清理时同步移除。
 */
const MEM_BUDGET = 24 * 1024 * 1024;
const g = globalThis as unknown as { __prismFileCache?: Map<string, { mime: string; data: Buffer }> };
const mem = (g.__prismFileCache ??= new Map());
let memBytes = 0;
function forget(id: string) {
  const v = mem.get(id);
  if (v) {
    memBytes -= v.data.length;
    mem.delete(id);
  }
}
function keep(id: string, v: { mime: string; data: Buffer }) {
  if (v.data.length > MEM_BUDGET / 8) return;
  forget(id);
  mem.set(id, v);
  memBytes += v.data.length;
  while (memBytes > MEM_BUDGET && mem.size) forget(mem.keys().next().value as string);
}

/** 清理图片后把这些图从本实例的内存缓存里去掉 */
export function forgetFiles(ids: string[]) {
  for (const id of ids) forget(id);
}

export async function readKvFile(id: string): Promise<{ mime: string; data: Buffer } | null> {
  const hit = mem.get(id);
  if (hit) {
    mem.delete(id);
    mem.set(id, hit);
    return hit;
  }
  const v = await readKvFileFromDb(id);
  if (v) keep(id, v);
  return v;
}

async function readKvFileFromDb(id: string): Promise<{ mime: string; data: Buffer } | null> {
  if (storageKind() === "mysql") {
    const rows = await q<RowDataPacket[]>(`SELECT mime, data FROM ${T.files} WHERE id = ?`, [id]);
    if (rows[0]) return { mime: rows[0].mime, data: Buffer.from(rows[0].data) };
  }
  const v = await kv().get<{ mime: string; data: string }>(P + "file:" + id);
  if (!v) return null;
  return { mime: v.mime, data: Buffer.from(v.data, "base64") };
}

/** 把任意图片地址（data: / 站内 /api/files / http）转成 base64，供上游使用 */
export async function resolveImage(url: string): Promise<{ data: string; mime: string }> {
  if (url.startsWith("data:")) {
    const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url);
    if (!m) throw new Error("无法解析的图片");
    const mime = m[1] || "image/png";
    const data = m[2] ? m[3] : Buffer.from(decodeURIComponent(m[3])).toString("base64");
    return { data, mime };
  }
  if (url.startsWith(FILES)) {
    const f = await readLocalImage(url);
    if (!f) throw new Error("图片不存在");
    return { data: f.data.toString("base64"), mime: f.mime };
  }
  // 本站发出去的完整链接（API 客户端把生图结果再传回来识图时）：签名对得上就直接读，不绕一圈 HTTP
  try {
    const x = new URL(url);
    if (x.pathname.startsWith(FILES) && verifyImgSig(x.pathname, x.searchParams)) {
      const f = await readLocalImage(x.pathname + x.search);
      if (f) return { data: f.data.toString("base64"), mime: f.mime };
    }
  } catch {}
  const f = await fetchRemoteImage(url);
  return { data: f.data.toString("base64"), mime: f.mime };
}

/** 读站内地址 /api/files/...（可带查询参数）对应的图片内容；读不到返回 null */
export async function readLocalImage(url: string): Promise<{ mime: string; data: Buffer } | null> {
  const q = url.indexOf("?");
  const path = q < 0 ? url : url.slice(0, q);
  const sp = new URLSearchParams(q < 0 ? "" : url.slice(q + 1));
  const rest = path.slice(FILES.length);
  if (rest === "ext") {
    const u = sp.get("u");
    return u ? fetchRemoteImage(u) : null;
  }
  const segs = rest.split("/").map((x) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return x;
    }
  });
  if (segs[0] === "b" || segs[0] === "bp") {
    const r = await readBlob(segs);
    if (!r) return null;
    return { mime: r.mime, data: Buffer.from(await new Response(r.body).arrayBuffer()) };
  }
  return readKvFile(segs[0].split(".")[0]);
}

/**
 * 读 Blob 里的图：segs 是 /api/files/ 后面按 / 切开并解码的各段。
 * - ["b", ...pathname]：私有 Blob，用 BLOB_READ_WRITE_TOKEN 读
 * - ["bp", host, ...pathname]：公开 Blob，服务端直接下载（只允许 *.public.blob.vercel-storage.com）
 */
export async function readBlob(segs: string[]): Promise<{ mime: string; body: ReadableStream<Uint8Array> } | null> {
  if (segs[0] === "b") {
    if (!env.blobToken) return null;
    const pathname = segs.slice(1).join("/");
    if (!pathname.startsWith("prism/")) return null;
    const { get } = await import("@vercel/blob");
    const r = await get(pathname, { access: "private", token: env.blobToken });
    if (!r || !r.stream) return null;
    return { mime: r.blob.contentType || "image/png", body: r.stream };
  }
  const host = segs[1] || "";
  if (!BLOB_PUBLIC_HOST.test(host)) return null;
  const pathname = segs.slice(2).map(encodeURIComponent).join("/");
  // 测试用：把公开 Blob 的请求转到本地模拟服务
  const base = process.env.PRISM_TEST_BLOB_ORIGIN ? `${process.env.PRISM_TEST_BLOB_ORIGIN}/${host}` : `https://${host}`;
  const res = await fetch(`${base}/${pathname}`, { signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!res || !res.ok || !res.body) return null;
  return { mime: res.headers.get("content-type")?.split(";")[0] || "image/png", body: res.body };
}

const REMOTE_MAX = 20 * 1024 * 1024;

/** 内网和保留地址：服务端下载外部图片时一律不允许访问，防止被拿来探测内网（SSRF） */
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b < 128) || // 运营商 NAT
      (a === 169 && b === 254) || // 链路本地，含云厂商元数据 169.254.169.254
      (a === 172 && b >= 16 && b < 32) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) || // 基准测试网段
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224 // 组播和保留
    );
  }
  const x = ip.toLowerCase().split("%")[0];
  if (!net.isIPv6(x)) return true; // 认不出来的一律当内网
  // IPv4 映射/兼容地址（::ffff:a.b.c.d、::ffff:7f00:1 这类十六进制写法也要拆出来）
  const m4 = /^(?:0*:)*:ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x) || /^::(\d+\.\d+\.\d+\.\d+)$/.exec(x);
  if (m4) return isPrivateIp(m4[1]);
  const mh = /^(?:0*:)*:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(x);
  if (mh) {
    const hi = parseInt(mh[1], 16), lo = parseInt(mh[2], 16);
    return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return (
    x === "::" ||
    x === "::1" ||
    /^f[cd]/.test(x) || // 唯一本地
    /^fe[89ab]/.test(x) || // 链路本地
    /^ff/.test(x) || // 组播
    x.startsWith("64:ff9b:") || // NAT64，可能指回内网 IPv4
    x.startsWith("2001:db8:") ||
    x.startsWith("2002:") // 6to4，可能嵌着内网 IPv4
  );
}

/** 测试用：PRISM_ALLOW_PRIVATE_IMAGE_FETCH=1 放行所有内网地址，或者写成 "127.0.0.1:9100,..." 只放行这几个 host:port */
function privateAllowed(u: URL) {
  const v = (process.env.PRISM_ALLOW_PRIVATE_IMAGE_FETCH || "").trim();
  if (!v) return false;
  if (v === "1") return true;
  return v
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .includes(u.host.toLowerCase());
}

/**
 * 解析域名并检查每个地址，返回第一个可用地址。
 * 真正连接时就用这个地址（见 safeDispatcher），不再重新解析，防止 DNS 重绑定：
 * 检查时解析到公网、连接时又解析到 127.0.0.1。
 */
async function resolvePublic(hostname: string): Promise<{ address: string; family: number }> {
  const h = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(h)) {
    if (isPrivateIp(h)) throw new Error("不允许访问内网地址");
    return { address: h, family: net.isIPv6(h) ? 6 : 4 };
  }
  const ips = await lookup(h, { all: true, verbatim: true });
  if (!ips.length || ips.some((r) => isPrivateIp(r.address))) throw new Error("不允许访问内网地址");
  return ips[0];
}

// 连接时用的 DNS 解析：只返回检查过的公网地址
let dispatcher: import("undici").Agent | null = null;
async function safeDispatcher() {
  if (dispatcher) return dispatcher;
  const { Agent } = await import("undici");
  dispatcher = new Agent({
    connect: {
      // Node 的 net.connect 开了 autoSelectFamily 时会带 all: true 调用，要回数组
      lookup(hostname, opts, cb) {
        const all = !!(opts as { all?: boolean })?.all;
        const done = cb as unknown as (err: Error | null, a?: unknown, f?: number) => void;
        resolvePublic(hostname).then(
          (r) => (all ? done(null, [r]) : done(null, r.address, r.family)),
          (e) => done(e as Error),
        );
      },
    },
  });
  return dispatcher;
}

/** 边读边数，超过上限立刻中断，不先把整个响应读进内存 */
async function readCapped(res: Response, max: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new Error("图片太大");
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

/**
 * 服务端下载外部图片：上游生图返回的临时链接、旧数据里的外链、模型回答里的图片、API 调用方传进来的识图链接。
 * - 一律拦截内网和保留地址，重定向的每一跳都检查；连接时用检查过的地址，防 DNS 重绑定
 * - 只接受 image/*，最大 20MB，20 秒超时；没有 content-length 时边读边数
 * - 测试环境可以用 PRISM_ALLOW_PRIVATE_IMAGE_FETCH 放行 mock 地址
 * opts.guardPrivate 保留参数只是为了兼容旧调用，现在始终开启。
 */
export async function fetchRemoteImage(url: string, _opts: { guardPrivate?: boolean } = {}): Promise<{ mime: string; data: Buffer }> {
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    let u: URL;
    try {
      u = new URL(cur);
    } catch {
      throw new Error("图片地址无效");
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("图片地址无效");
    if (u.username || u.password) throw new Error("图片地址无效");
    const allowed = privateAllowed(u);
    let res: Response;
    if (allowed) {
      res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(20000), headers: { accept: "image/*,*/*;q=0.5" } });
    } else {
      await resolvePublic(u.hostname); // 先查一遍，给出清楚的报错
      const { fetch: ufetch } = await import("undici");
      res = (await ufetch(u, {
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
        headers: { accept: "image/*,*/*;q=0.5" },
        dispatcher: await safeDispatcher(),
      })) as unknown as Response;
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      cur = new URL(res.headers.get("location")!, u).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`下载图片失败：${res.status}`);
    }
    let mime = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
    const len = Number(res.headers.get("content-length") || 0);
    if (len > REMOTE_MAX) {
      await res.body?.cancel().catch(() => {});
      throw new Error("图片太大");
    }
    const data = await readCapped(res, REMOTE_MAX);
    if (!mime.startsWith("image/") || mime === "image/svg+xml") {
      const sniffed = sniffImage(data);
      if (!sniffed) throw new Error("链接返回的不是图片");
      mime = sniffed;
    }
    return { mime, data };
  }
  throw new Error("图片地址重定向次数太多");
}

/** 有的存储返回 application/octet-stream：看文件头认出常见图片格式 */
function sniffImage(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.slice(0, 4).toString() === "GIF8") return "image/gif";
  if (b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP") return "image/webp";
  if (b.slice(4, 8).toString() === "ftyp" && /^avi[fs]$/.test(b.slice(8, 12).toString())) return "image/avif";
  return null;
}

/**
 * 上游生图返回的是临时链接（比如 OpenAI 的 *.blob.core.windows.net）时，服务端立刻下载并存好，返回本站地址。
 * 下载两次都失败时，退回到经本站转发的外链代理地址，浏览器仍然只访问本站。
 */
export async function persistRemoteImage(url: string): Promise<string> {
  for (let i = 0; i < 2; i++) {
    try {
      const f = await resolveImage(url);
      return await saveFile(Buffer.from(f.data, "base64"), f.mime);
    } catch (e) {
      if (i === 1) console.error("[prism] 转存上游图片失败，改用转发地址", (e as Error)?.message || e);
    }
  }
  return localImageUrl(url);
}


// ===== 视频 =====

/**
 * 视频转存上限：接了 Blob 时 20MB；存 MySQL 时 15MB（prism_files.data 是 MEDIUMBLOB，单行最多 16MB）。
 * 几秒钟的 480p/720p 视频一般 1–5MB，正常用不会碰到。
 */
export function videoMaxBytes() {
  return env.blobToken ? 20 * 1024 * 1024 : 15 * 1024 * 1024;
}

/**
 * 视频服务的结果只允许从这几类域名下载 / 转发：
 * - *.hf.space（Hugging Face Space 的 Gradio 文件地址）
 * - huggingface.co（及其 CDN 子域）
 * - *.bigmodel.cn / *.zhipuai.cn（智谱生成结果和封面）
 * 测试时 PRISM_TEST_VIDEO_HOSTS 可以再放行几个 host:port（逗号分隔，线上不要设）。
 */
export function videoHostAllowed(u: URL): boolean {
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase();
  const test = (process.env.PRISM_TEST_VIDEO_HOSTS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (test.includes(u.host.toLowerCase())) return true;
  if (u.protocol !== "https:") return false;
  return (
    /^[a-z0-9-]+\.hf\.space$/.test(h) ||
    h === "huggingface.co" ||
    h.endsWith(".huggingface.co") ||
    h.endsWith(".hf.co") ||
    h === "bigmodel.cn" ||
    h.endsWith(".bigmodel.cn") ||
    h.endsWith(".zhipuai.cn")
  );
}

function sniffVideo(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b.slice(4, 8).toString() === "ftyp") return "video/mp4";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  return null;
}

/** 打开一个外部地址（只允许视频服务域名；拦内网、防 DNS 重绑定，重定向每一跳都检查）。返回未读的响应 */
async function openAllowed(url: string, headers: Record<string, string>, timeoutMs: number): Promise<Response> {
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    let u: URL;
    try {
      u = new URL(cur);
    } catch {
      throw new Error("视频地址无效");
    }
    if (u.username || u.password || !videoHostAllowed(u)) throw new Error("不允许访问这个地址");
    let res: Response;
    if (privateAllowed(u)) {
      res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers });
    } else {
      await resolvePublic(u.hostname);
      const { fetch: ufetch } = await import("undici");
      res = (await ufetch(u, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers, dispatcher: await safeDispatcher() })) as unknown as Response;
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      cur = new URL(res.headers.get("location")!, u).toString();
      continue;
    }
    return res;
  }
  throw new Error("视频地址重定向次数太多");
}

/** 下载视频（或封面图）：只认视频服务域名，最大 max 字节，60 秒超时 */
export async function fetchRemoteVideo(url: string, max = videoMaxBytes()): Promise<{ mime: string; data: Buffer }> {
  const res = await openAllowed(url, { accept: "video/*,*/*;q=0.5" }, 60000);
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`下载视频失败：${res.status}`);
  }
  const len = Number(res.headers.get("content-length") || 0);
  if (len > max) {
    await res.body?.cancel().catch(() => {});
    throw Object.assign(new Error("视频太大"), { tooBig: true });
  }
  let data: Buffer;
  try {
    data = await readCapped(res, max);
  } catch (e) {
    if (/太大/.test(String((e as Error).message))) throw Object.assign(new Error("视频太大"), { tooBig: true });
    throw e;
  }
  const real = sniffVideo(data);
  if (!real) throw new Error("链接返回的不是视频");
  return { mime: real, data };
}

/** 下载视频服务给的封面图（同样只认视频服务域名） */
export async function fetchRemotePoster(url: string): Promise<{ mime: string; data: Buffer }> {
  const res = await openAllowed(url, { accept: "image/*" }, 20000);
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`下载封面失败：${res.status}`);
  }
  const data = await readCapped(res, 5 * 1024 * 1024);
  const mime = sniffImage(data);
  if (!mime) throw new Error("封面不是图片");
  return { mime, data };
}

/**
 * 转存视频：成功返回本站地址；太大或下载失败时退回经本站转发的原链接（temp=true，原链接过期后就打不开了）。
 * 下载失败重试一次。
 */
export async function persistRemoteVideo(url: string): Promise<{ url: string; temp: boolean; reason?: string }> {
  let reason = "";
  for (let i = 0; i < 2; i++) {
    try {
      const f = await fetchRemoteVideo(url);
      return { url: await saveFile(f.data, f.mime, "videos"), temp: false };
    } catch (e) {
      reason = (e as Error).message;
      if ((e as { tooBig?: boolean }).tooBig) break;
    }
  }
  console.error("[prism] 转存视频失败，改用转发地址", reason);
  return { url: localVideoUrl(url), temp: true, reason };
}

export async function persistRemotePoster(url: string): Promise<string | undefined> {
  try {
    const f = await fetchRemotePoster(url);
    return await saveFile(f.data, f.mime);
  } catch (e) {
    console.error("[prism] 转存视频封面失败", (e as Error).message);
    return undefined;
  }
}

/**
 * 转发外部视频（/api/files/vext?u=...）：浏览器只访问本站。把 Range 原样带给对方，边收边发，不整段读进内存。
 * 只允许视频服务域名；最多转发 60MB。
 */
export async function openRemoteVideo(url: string, range?: string | null): Promise<Response> {
  const headers: Record<string, string> = { accept: "video/*,*/*;q=0.5" };
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.range = range;
  return openAllowed(url, headers, 60000);
}
