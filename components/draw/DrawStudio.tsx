"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Copy,
  Download,
  ImagePlus,
  Loader2,
  MessageSquare,
  Palette,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { useApp } from "@/components/AppContext";
import { Modal, PageHeader, copyText, toast } from "@/components/ui";
import { api, fmtMs, fmtTime, uploadImage } from "@/lib/client/api";
import { imgSrc, thumbOf } from "@/lib/client/thumb";
import { aspectOfSize, imageProfile, sizeForRatio, sizeLabel } from "@/lib/draw/profiles";
import { cancelJob, clearFinished, dismissJob, restorePending, retryJob, startJob, useDrawJobs, type DrawJob } from "@/lib/client/drawJobs";
import { setChatDraft, takeDrawDraft } from "@/lib/client/promptlib";
import { fillVars, parseVars } from "@/lib/prompts/template";
import type { ChannelType, GalleryItem } from "@/lib/types";

interface ImgModel {
  key: string;
  model: string;
  channelId: string;
  channelName: string;
  upstream: string;
  type: ChannelType;
  disabled: boolean;
}
interface Form {
  key: string;
  size: string;
  n: number;
  quality: string;
}
interface Tile {
  url: string;
  prompt: string;
  model: string;
  size?: string;
  createdAt: number;
  galleryId?: string;
  job?: DrawJob;
}

const FORM_KEY = "prism-draw-form";
const PAGE = 48;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

async function download(url: string, name: string) {
  const src = imgSrc(url);
  try {
    const r = await fetch(src);
    if (!r.ok) throw new Error(String(r.status));
    const b = await r.blob();
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = u;
    a.download = `${name}.${EXT[b.type.split(";")[0]] || "png"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 10_000);
  } catch {
    window.open(src, "_blank", "noopener");
    toast("没能直接保存，已在新标签页打开，可长按或右键另存", "err");
  }
}

export function DrawStudio() {
  const { catalog, settings, ready } = useApp();
  const router = useRouter();
  const jobs = useDrawJobs();

  const models = useMemo<ImgModel[]>(() => {
    const out: ImgModel[] = [];
    for (const g of catalog)
      for (const m of g.models)
        if (m.caps.includes("image")) out.push({ key: `${g.channelId}|${m.id}`, model: m.id, channelId: g.channelId, channelName: g.channelName, upstream: m.upstream, type: g.type, disabled: g.disabled });
    return out;
  }, [catalog]);

  const [form, setForm] = useState<Form>({ key: "", size: "1024x1024", n: 1, quality: "" });
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<string[]>([]);
  const [fromKey, setFromKey] = useState<string | undefined>();
  const [uploading, setUploading] = useState(0);
  const [drag, setDrag] = useState(false);
  const [view, setView] = useState<Tile | null>(null);
  const [hist, setHist] = useState<GalleryItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const pendingRatio = useRef<string | undefined>(undefined);
  const inited = useRef(false);

  const cur = models.find((m) => m.key === form.key);
  const profile = useMemo(() => imageProfile(cur?.model || "", cur?.upstream, cur?.type), [cur]);

  // 初始化：上次的选择 + 从提示词库带来的草稿（提示词和建议比例）
  useEffect(() => {
    if (!ready || inited.current) return;
    inited.current = true;
    restorePending();
    let saved: Partial<Form> & { prompt?: string } = {};
    try {
      saved = JSON.parse(localStorage.getItem(FORM_KEY) || "{}");
    } catch {
      /* 忽略 */
    }
    const live = models.filter((m) => !m.disabled);
    const pick =
      live.find((m) => m.key === saved.key) ||
      live.find((m) => m.model === settings.defaultImageModel) ||
      live[0] ||
      models[0];
    setForm((f) => ({ ...f, ...saved, key: pick?.key || "" }));
    const d = takeDrawDraft();
    if (d) {
      setPrompt(d.prompt);
      setFromKey(d.key);
      if (d.refs) setRefs(d.refs);
      if (d.model) {
        const m = live.find((x) => x.model === d.model);
        if (m) setForm((f) => ({ ...f, key: m.key }));
      }
      // 建议比例换成这个模型能用的最接近的尺寸
      const m = (d.model && live.find((x) => x.model === d.model)) || pick;
      const want = d.size || (m ? sizeForRatio(d.ratio, imageProfile(m.model, m.upstream, m.type).sizes) : null);
      if (want) setForm((f) => ({ ...f, size: want }));
      else pendingRatio.current = d.ratio;
      toast(d.ratio ? `已带入提示词（建议比例 ${d.ratio}）` : "已带入提示词", "ok");
    } else if (saved.prompt) setPrompt(saved.prompt);
  }, [ready, models, settings.defaultImageModel]);

  // 换模型后把尺寸、张数、质量收拢到这个模型能用的范围；有建议比例时选最接近的尺寸
  useEffect(() => {
    if (!cur) return;
    setForm((f) => {
      let size = f.size;
      const want = sizeForRatio(pendingRatio.current, profile.sizes);
      if (want) size = want;
      else if (!profile.sizes.includes(size)) size = sizeForRatio("1:1", profile.sizes) || profile.sizes[0];
      const n = Math.min(f.n, profile.maxN);
      const quality = profile.qualities.some((q) => q.v === f.quality) ? f.quality : "";
      return size === f.size && n === f.n && quality === f.quality ? f : { ...f, size, n, quality };
    });
    if (pendingRatio.current && profile.sizes.length) pendingRatio.current = undefined;
  }, [cur, profile]);

  // 记住这次的选择（下次打开还是它）
  useEffect(() => {
    if (!inited.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(FORM_KEY, JSON.stringify({ ...form, prompt: prompt.slice(0, 4000) }));
      } catch {
        /* 忽略 */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [form, prompt]);

  // 历史作品：图库里的图片，一次一页
  const loadHist = useCallback(async (offset = 0) => {
    try {
      const r = await api<{ items: GalleryItem[]; total: number }>(`/api/gallery?kind=image&offset=${offset}&limit=${PAGE}`);
      setHist((h) => (offset ? [...(h || []), ...r.items.filter((x) => !(h || []).some((y) => y.id === x.id))] : r.items));
      setTotal(r.total);
    } catch (e) {
      toast((e as Error).message, "err");
      setHist((h) => h || []);
    }
  }, []);
  useEffect(() => {
    void loadHist(0);
  }, [loadHist]);

  // 生成中每秒走一下计时
  const busy = jobs.some((j) => j.status === "running" || j.status === "recovering");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const vars = useMemo(() => parseVars(prompt), [prompt]);

  const generate = useCallback(() => {
    if (!cur) return toast("还没有可用的生图模型，去渠道页启用一个吧", "err");
    const text = fillVars(prompt, []).trim();
    if (!text) {
      textRef.current?.focus();
      return toast("先写一段画面描述");
    }
    if (uploading) return toast("参考图还在上传，稍等一下");
    startJob({ model: cur.model, channelId: cur.channelId, prompt: text, size: form.size, n: form.n, quality: form.quality, refs, key: fromKey });
  }, [cur, prompt, uploading, form, refs, fromKey]);

  // Ctrl/⌘ + Enter 生成
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !view) {
        e.preventDefault();
        generate();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [generate, view]);

  async function addFiles(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    const room = 4 - refs.length;
    if (room <= 0) return toast("最多 4 张参考图");
    setUploading((n) => n + Math.min(room, imgs.length));
    for (const f of imgs.slice(0, room)) {
      try {
        const url = await uploadImage(f);
        setRefs((r) => [...r, url].slice(0, 4));
      } catch (e) {
        toast((e as Error).message, "err");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function reuse(t: Tile) {
    setPrompt(t.prompt);
    setFromKey(t.job?.key);
    const m = models.find((x) => x.key === `${t.job?.channelId}|${t.model}`) || models.find((x) => x.model === t.model && !x.disabled);
    if (m) setForm((f) => ({ ...f, key: m.key, ...(t.size ? { size: t.size } : {}), ...(t.job ? { n: t.job.n, quality: t.job.quality } : {}) }));
    if (t.job) setRefs(t.job.refs);
    setView(null);
    textRef.current?.focus();
    textRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    toast("已填入提示词和参数", "ok");
  }
  function again(t: Tile) {
    const m = models.find((x) => x.key === `${t.job?.channelId}|${t.model}`) || models.find((x) => x.model === t.model && !x.disabled) || cur;
    if (!m) return toast("这个模型现在不可用", "err");
    startJob({ model: m.model, channelId: m.channelId, prompt: t.prompt, size: t.size || form.size, n: t.job?.n || 1, quality: t.job?.quality || "", refs: t.job?.refs || [], key: t.job?.key });
    setView(null);
    toast("已开始重新生成", "ok");
  }
  function toChat(t: Tile) {
    setChatDraft({ text: "", mode: "chat", images: [t.url] });
    router.push("/?new=" + Date.now());
  }
  function asRef(t: Tile) {
    if (refs.includes(t.url)) return toast("已经在参考图里了");
    if (refs.length >= 4) return toast("最多 4 张参考图");
    setRefs((r) => [...r, t.url]);
    setView(null);
    toast("已加为参考图，改一改描述再生成吧", "ok");
  }
  async function remove(t: Tile) {
    if (!t.galleryId || !confirm("从图库里删除这张图？对话里的记录不受影响。")) return;
    try {
      await api(`/api/gallery/${t.galleryId}`, { method: "DELETE" });
      setHist((h) => (h || []).filter((x) => x.id !== t.galleryId));
      setView(null);
      toast("已删除", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  const active = jobs.filter((j) => j.status !== "done");
  const doneTiles: Tile[] = jobs
    .filter((j) => j.status === "done")
    .flatMap((j) => (j.images || []).map((url) => ({ url, prompt: j.prompt, model: j.model, size: j.size, createdAt: j.end || j.start, job: j })));
  const seenUrls = new Set(doneTiles.map((t) => t.url));
  const histTiles: Tile[] = (hist || [])
    .filter((x) => !seenUrls.has(x.url))
    .map((x) => ({ url: x.url, prompt: x.prompt, model: x.model, size: x.size, createdAt: x.createdAt, galleryId: x.id }));
  const noModels = ready && !models.length;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader
        title="画图"
        sub="写描述、挑参数、出图；作品自动存进图库"
        right={
          <Link href="/prompts" className="btn-ghost btn-sm">
            <BookOpen size={13} /> 提示词库
          </Link>
        }
      />
      <div className="mx-auto max-w-7xl px-4 pb-10 pt-4 md:px-8 lg:grid lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start lg:gap-6">
        {/* ===== 左：参数 ===== */}
        <aside className="card mb-5 p-4 lg:sticky lg:top-[76px] lg:mb-0 lg:max-h-[calc(100dvh-96px)] lg:overflow-y-auto scroll-thin" data-testid="draw-panel">
          {noModels ? (
            <div className="py-6 text-center text-sm text-muted">
              <p>还没有可用的生图模型。</p>
              <p className="mt-1 text-xs">在渠道里给模型打上「生图」标签就能在这里用。</p>
              <Link href="/channels" className="btn-primary btn-sm mt-3">
                去渠道页
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              <label className="block">
                <span className="label">模型</span>
                {!ready ? (
                  <div className="shimmer h-9 rounded-xl" />
                ) : (
                  <select className="input" value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))} data-testid="draw-model">
                    {Array.from(new Set(models.map((m) => m.channelId))).map((cid) => {
                      const list = models.filter((m) => m.channelId === cid);
                      return (
                        <optgroup key={cid} label={list[0].channelName + (list[0].disabled ? "（已停用）" : "")}>
                          {list.map((m) => (
                            <option key={m.key} value={m.key} disabled={m.disabled}>
                              {m.model}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                )}
                {profile.hint && <span className="mt-1 block text-[11px] leading-relaxed text-muted">{profile.hint}</span>}
              </label>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted">画面描述</span>
                  <span className="flex items-center gap-2 text-[11px] text-muted">
                    <Link href="/prompts" className="hover:text-acc-ink">
                      从提示词库挑
                    </Link>
                    {prompt && (
                      <button
                        className="hover:text-bad"
                        onClick={() => {
                          setPrompt("");
                          setFromKey(undefined);
                        }}
                      >
                        清空
                      </button>
                    )}
                  </span>
                </div>
                <textarea
                  ref={textRef}
                  className="input min-h-36 resize-y text-[14px] leading-relaxed"
                  rows={6}
                  value={prompt}
                  placeholder="描述你想要的画面：主体、场景、风格、光线、镜头…&#10;可以粘贴或拖进图片当参考图"
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    if (!e.target.value) setFromKey(undefined);
                  }}
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files);
                    if (files.some((f) => f.type.startsWith("image/"))) {
                      e.preventDefault();
                      void addFiles(files);
                    }
                  }}
                  data-testid="draw-prompt"
                />
                <div className="mt-1 flex justify-between text-[11px] text-muted">
                  <span>{vars.length ? `含 ${vars.length} 个变量，生成时用默认值；想改去提示词库里填` : ""}</span>
                  <span>{prompt.length} 字</span>
                </div>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  void addFiles(Array.from(e.dataTransfer.files));
                }}
              >
                <span className="label">参考图（可选，最多 4 张；用来改图、换风格）</span>
                <div className={`flex flex-wrap gap-2 rounded-xl ${drag ? "ring-2 ring-acc" : ""}`}>
                  {refs.map((u) => (
                    <div key={u} className="relative h-16 w-16 overflow-hidden rounded-lg border border-rule">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbOf(u, 256)} alt="参考图" className="h-full w-full object-cover" />
                      <button className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white" onClick={() => setRefs((r) => r.filter((x) => x !== u))} aria-label="移除参考图">
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                  {Array.from({ length: uploading }, (_, i) => (
                    <div key={"u" + i} className="flex h-16 w-16 items-center justify-center rounded-lg border border-rule bg-soft">
                      <Loader2 size={16} className="animate-spin text-muted" />
                    </div>
                  ))}
                  {refs.length + uploading < 4 && (
                    <button className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-rule text-[10px] text-muted hover:bg-hover" onClick={() => fileRef.current?.click()}>
                      <ImagePlus size={16} /> 添加
                    </button>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => {
                      const f = Array.from(e.target.files || []);
                      e.target.value = "";
                      void addFiles(f);
                    }}
                  />
                </div>
              </div>

              <div>
                <span className="label">比例 / 尺寸</span>
                <div className="flex flex-wrap gap-1.5" role="radiogroup">
                  {profile.sizes.map((s) => (
                    <button key={s} role="radio" aria-checked={form.size === s} className={`chip ${form.size === s ? "chip-on" : ""}`} onClick={() => setForm((f) => ({ ...f, size: s }))} title={s}>
                      {s !== "auto" && <span className="inline-block border border-current opacity-60" style={{ aspectRatio: aspectOfSize(s), height: 11 }} />}
                      {sizeLabel(s)}
                      {s !== "auto" && <span className="hidden text-[10px] opacity-60 sm:inline">{s}</span>}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-4">
                <div>
                  <span className="label">张数</span>
                  <div className="inline-flex rounded-xl border border-rule p-0.5">
                    {Array.from({ length: profile.maxN }, (_, i) => i + 1).map((n) => (
                      <button key={n} className={`h-7 w-8 rounded-lg text-sm ${form.n === n ? "bg-soft font-semibold text-acc-ink" : "text-muted"}`} onClick={() => setForm((f) => ({ ...f, n }))}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                {profile.qualities.length > 0 && (
                  <div>
                    <span className="label">质量</span>
                    <div className="inline-flex rounded-xl border border-rule p-0.5">
                      {profile.qualities.map((q) => (
                        <button key={q.v} className={`h-7 rounded-lg px-2.5 text-xs ${form.quality === q.v ? "bg-soft font-semibold text-acc-ink" : "text-muted"}`} onClick={() => setForm((f) => ({ ...f, quality: q.v }))}>
                          {q.l}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="sticky bottom-0 -mx-4 -mb-4 border-t border-rule bg-card/95 px-4 pb-4 pt-3 backdrop-blur lg:static lg:mx-0 lg:mb-0 lg:border-0 lg:bg-transparent lg:p-0">
                <button className="btn-primary w-full py-2.5 text-[15px]" onClick={generate} disabled={!cur || !ready} data-testid="draw-go">
                  <Wand2 size={17} /> 生成{form.n > 1 ? ` ${form.n} 张` : ""}
                </button>
                <p className="mt-1.5 hidden text-center text-[11px] text-muted sm:block">Ctrl / ⌘ + Enter 生成 · 可以连续提交，排队并行出图</p>
              </div>
            </div>
          )}
        </aside>

        {/* ===== 右：队列和作品 ===== */}
        <section className="min-w-0">
          {active.length > 0 && (
            <div className="mb-5 space-y-2" data-testid="draw-queue">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">生成队列</h2>
                {active.some((j) => j.status === "error") && (
                  <button className="text-xs text-muted hover:text-ink" onClick={clearFinished}>
                    清除失败的
                  </button>
                )}
              </div>
              {active.map((j) => (
                <div key={j.id} className={`card p-3 ${j.status === "error" ? "border-bad/40" : ""}`}>
                  <div className="flex items-center gap-2 text-xs">
                    {j.status === "error" ? <AlertTriangle size={14} className="text-bad" /> : <Loader2 size={14} className="animate-spin text-acc" />}
                    <b className="truncate font-mono font-medium">{j.model}</b>
                    <span className="text-muted">
                      {sizeLabel(j.size)} · {j.n} 张
                    </span>
                    <span className="ml-auto shrink-0 text-muted">{Math.round(((j.end || now) - j.start) / 1000)}s</span>
                    {j.status === "running" ? (
                      <button className="rounded-md p-1 text-muted hover:bg-hover hover:text-bad" onClick={() => cancelJob(j.id)} title="停止" aria-label="停止">
                        <Square size={12} fill="currentColor" />
                      </button>
                    ) : (
                      <button className="rounded-md p-1 text-muted hover:bg-hover" onClick={() => dismissJob(j.id)} title="关闭" aria-label="关闭">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{j.prompt}</p>
                  {j.status === "error" ? (
                    <div className="mt-2 rounded-lg bg-bad/5 px-2.5 py-2 text-xs">
                      <div className="font-semibold text-bad">{j.error?.title}</div>
                      <div className="mt-0.5 whitespace-pre-wrap text-ink/80">{j.error?.message}</div>
                      <div className="mt-2 flex gap-2">
                        <button className="btn-ghost btn-sm" onClick={() => retryJob(j.id)}>
                          <RotateCcw size={12} /> 重试
                        </button>
                        {j.error?.fix === "channels" && (
                          <Link href="/channels" className="btn-ghost btn-sm">
                            去渠道页
                          </Link>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-soft">
                        <div className="shimmer h-full w-full" />
                      </div>
                      <p className="mt-1 text-[11px] text-muted">{j.status === "recovering" ? "连接断了，正在图库里找这次的结果…" : "生成中，一般要 10 秒到 2 分钟"}</p>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {(doneTiles.length > 0 || jobs.some((j) => j.status === "running")) && (
            <div className="mb-6">
              <h2 className="mb-2 text-sm font-semibold">本次生成</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {jobs
                  .filter((j) => j.status === "running" || j.status === "recovering")
                  .flatMap((j) => Array.from({ length: j.n }, (_, i) => (
                    <div key={j.id + i} className="shimmer rounded-2xl" style={{ aspectRatio: aspectOfSize(j.size) }} aria-label="生成中" />
                  )))}
                {doneTiles.map((t) => (
                  <TileCard key={t.url} t={t} onOpen={setView} fresh />
                ))}
              </div>
              {jobs.some((j) => j.status === "done" && (j.notices?.length || j.recovered)) && (
                <div className="mt-2 space-y-1">
                  {jobs
                    .filter((j) => j.status === "done" && (j.notices?.length || j.recovered))
                    .map((j) => (
                      <p key={j.id} className="text-[11px] text-muted">
                        {j.recovered ? "有一组结果是在连接断开后从图库里找回来的。" : ""}
                        {j.notices?.join("；")}
                      </p>
                    ))}
                </div>
              )}
            </div>
          )}

          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">历史作品{total ? <span className="ml-1 font-normal text-muted">{total}</span> : null}</h2>
            <div className="flex items-center gap-2">
              <button className="rounded-lg p-1 text-muted hover:bg-hover" onClick={() => void loadHist(0)} aria-label="刷新" title="刷新">
                <RefreshCw size={14} />
              </button>
              <Link href="/gallery" className="text-xs text-muted hover:text-ink">
                去图库管理
              </Link>
            </div>
          </div>
          {hist === null ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-hidden>
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="shimmer aspect-square rounded-2xl" />
              ))}
            </div>
          ) : !histTiles.length ? (
            <div className="card px-6 py-12 text-center text-sm text-muted">
              {doneTiles.length ? "其余作品都在上面了" : "还没有作品。写一段描述试试，或者去提示词库挑一条现成的。"}
              {!doneTiles.length && (
                <div className="mt-3">
                  <Link href="/prompts" className="btn-ghost btn-sm">
                    <BookOpen size={13} /> 打开提示词库
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {histTiles.map((t) => (
                  <TileCard key={t.url} t={t} onOpen={setView} />
                ))}
              </div>
              {(hist?.length || 0) < total && (
                <div className="py-5 text-center">
                  <button
                    className="btn-ghost btn-sm"
                    disabled={loadingMore}
                    onClick={async () => {
                      setLoadingMore(true);
                      await loadHist(hist?.length || 0);
                      setLoadingMore(false);
                    }}
                  >
                    {loadingMore && <Loader2 size={12} className="animate-spin" />} 显示更多（{hist?.length} / {total}）
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <Modal open={!!view} onClose={() => setView(null)} title="作品" wide>
        {view && (
          <div>
            <div className="mx-auto overflow-hidden rounded-xl bg-soft" style={{ aspectRatio: aspectOfSize(view.size), maxHeight: "60vh" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imgSrc(view.url)} alt={view.prompt} className="h-full w-full object-contain" />
            </div>
            <p className="mt-3 max-h-32 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed scroll-thin">{view.prompt}</p>
            <p className="mt-1 text-xs text-muted">
              {view.model}
              {view.size ? ` · ${view.size}` : ""} · {fmtTime(view.createdAt)}
              {view.job?.latencyMs ? ` · 用时 ${fmtMs(view.job.latencyMs)}` : ""}
              {view.job?.channel ? ` · ${view.job.channel}` : ""}
            </p>
            {view.job?.revisedPrompt && <p className="mt-1 text-xs text-muted">模型改写后的描述：{view.job.revisedPrompt}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn-primary btn-sm" onClick={() => void download(view.url, `prism-${Date.now()}`)}>
                <Download size={13} /> 保存
              </button>
              <button className="btn-ghost btn-sm" onClick={() => reuse(view)}>
                <Palette size={13} /> 复用提示词
              </button>
              <button className="btn-ghost btn-sm" onClick={() => again(view)}>
                <RotateCcw size={13} /> 再来一次
              </button>
              <button className="btn-ghost btn-sm" onClick={() => asRef(view)}>
                <ImagePlus size={13} /> 作参考图
              </button>
              <button className="btn-ghost btn-sm" onClick={() => toChat(view)}>
                <MessageSquare size={13} /> 发到对话
              </button>
              <button className="btn-ghost btn-sm" onClick={() => copyText(view.prompt, "提示词已复制")}>
                <Copy size={13} /> 复制提示词
              </button>
              {view.galleryId && (
                <button className="btn-danger btn-sm ml-auto" onClick={() => void remove(view)}>
                  <Trash2 size={13} /> 删除
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function TileCard({ t, onOpen, fresh }: { t: Tile; onOpen: (t: Tile) => void; fresh?: boolean }) {
  return (
    <button className={`group card relative block overflow-hidden text-left ${fresh ? "ring-2 ring-acc/40" : ""}`} onClick={() => onOpen(t)} data-testid="draw-tile">
      <div className="relative overflow-hidden bg-soft" style={{ aspectRatio: aspectOfSize(t.size) }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumbOf(t.url, 512)} alt={t.prompt} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-[1.03]" />
      </div>
      <div className="p-2">
        <div className="line-clamp-1 text-xs">{t.prompt || "（无描述）"}</div>
        <div className="mt-0.5 truncate text-[10px] text-muted">
          {t.model} · {fmtTime(t.createdAt)}
        </div>
      </div>
    </button>
  );
}
