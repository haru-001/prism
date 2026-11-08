"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, CheckSquare, Copy, Download, Film, Loader2, MessageSquare, Play, Search, Trash2, X } from "lucide-react";
import { Empty, Modal, PageHeader, copyText, toast } from "@/components/ui";
import { api, fmtTime } from "@/lib/client/api";
import { imgSrc, thumbOf } from "@/lib/client/thumb";
import { copy, fill } from "@/lib/copy";
import type { GalleryItem } from "@/lib/types";
import { RinnePageHead } from "@/components/rinne/RinnePageHead";


const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "video/mp4": "mp4", "video/webm": "webm" };

/** 保存到本地：先取回文件再下载（跨域链接也能存成文件，扩展名按实际类型）；取不回就新标签页打开 */
async function download(item: GalleryItem) {
  const src = imgSrc(item.url);
  try {
    const r = await fetch(src);
    if (!r.ok) throw new Error(String(r.status));
    const b = await r.blob();
    const ext = EXT[b.type.split(";")[0]] || (item.kind === "video" ? "mp4" : "png");
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = u;
    a.download = `prism-${item.id}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 10_000);
    return true;
  } catch {
    window.open(src, "_blank", "noopener");
    return false;
  }
}

export default function GalleryPage() {
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [q, setQ] = useState("");
  const [view, setView] = useState<GalleryItem | null>(null);
  const [kind, setKind] = useState<"all" | "image" | "video">("all");

  useEffect(() => {
    api<{ items: GalleryItem[] }>("/api/gallery")
      .then((r) => setItems(r.items))
      .catch((e) => {
        toast((e as Error).message, "err");
        setItems([]);
      });
  }, []);

  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function remove(item: GalleryItem) {
    if (!confirm(item.kind === "video" ? "从图库里删除这段视频？对话里的记录不受影响。" : "从图库里删除这张图？对话里的记录不受影响。")) return;
    try {
      await api(`/api/gallery/${item.id}`, { method: "DELETE" });
      setItems((l) => (l || []).filter((x) => x.id !== item.id));
      setView(null);
      toast("已删除", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  async function save(item: GalleryItem) {
    toast("正在保存…", "ok");
    if (!(await download(item))) toast("没能直接保存，已在新标签页打开，可右键另存", "err");
  }

  function togglePick(id: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function endPick() {
    setPicking(false);
    setPicked(new Set());
  }

  async function removePicked() {
    const ids = Array.from(picked);
    if (!ids.length || !confirm(`从图库里删除选中的 ${ids.length} 项？对话里的记录不受影响。`)) return;
    setBusy(true);
    const ok: string[] = [];
    for (const id of ids) {
      try {
        await api(`/api/gallery/${id}`, { method: "DELETE" });
        ok.push(id);
      } catch {
        /* 失败的留着，下面提示 */
      }
    }
    setItems((l) => (l || []).filter((x) => !ok.includes(x.id)));
    setBusy(false);
    endPick();
    toast(ok.length === ids.length ? `已删除 ${ok.length} 项` : `删除了 ${ok.length} 项，${ids.length - ok.length} 项失败`, ok.length === ids.length ? "ok" : "err");
  }

  async function savePicked() {
    const sel = (items || []).filter((i) => picked.has(i.id));
    if (!sel.length) return;
    setBusy(true);
    let fail = 0;
    for (const i of sel) {
      if (!(await download(i))) fail++;
      await new Promise((r) => setTimeout(r, 300)); // 浏览器连续下载需要一点间隔
    }
    setBusy(false);
    toast(fail ? `已保存 ${sel.length - fail} 项，${fail} 项在新标签页打开` : `已保存 ${sel.length} 项`, fail ? "err" : "ok");
  }

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (items || []).filter(
      (i) => (kind === "all" || (kind === "video") === (i.kind === "video")) && (!kw || i.prompt.toLowerCase().includes(kw) || i.model.toLowerCase().includes(kw)),
    );
  }, [items, q, kind]);
  const videos = (items || []).filter((i) => i.kind === "video").length;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader
        title="图库"
        sub={items ? (videos ? (items.length > videos ? `共 ${items.length - videos} 张图、${videos} 段视频` : `共 ${videos} 段视频`) : `共 ${items.length} 张`) : undefined}
        right={
          items && items.length > 0 ? (
            <div className="flex items-center gap-2">
            <button className={`btn-ghost btn-sm ${picking ? "chip-on" : ""}`} onClick={() => (picking ? endPick() : setPicking(true))} data-testid="gallery-pick">
              {picking ? <X size={13} /> : <CheckSquare size={13} />} {picking ? "取消" : "批量"}
            </button>
            <label className="flex w-44 items-center gap-2 rounded-xl border border-rule bg-card px-3 py-1.5 sm:w-60">
              <Search size={14} className="text-muted" />
              <input className="w-full bg-transparent text-sm outline-none placeholder:text-muted" placeholder="搜索提示词" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            </div>
          ) : undefined
        }
      />
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
        {items && items.length > 0 && (
          <div className="mb-6">
            <RinnePageHead page="gallery">{videos ? fill(items.length > videos ? copy.gallery.sayVideo : copy.gallery.sayVideoOnly, { n: items.length - videos, v: videos }) : fill(copy.gallery.say, { n: items.length })}</RinnePageHead>
          </div>
        )}
        {items && videos > 0 && (
          <div className="mb-4 flex gap-1.5" role="tablist" data-testid="gallery-kind">
            {(
              [
                ["all", "全部"],
                ["image", "图片"],
                ["video", "视频"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={kind === k} className={`chip px-3 py-1 text-sm ${kind === k ? "chip-on" : ""}`} onClick={() => setKind(k)}>
                {k === "video" && <Film size={13} />} {l}
              </button>
            ))}
          </div>
        )}
        {items === null ? (
          <div className="flex justify-center py-16 text-muted">
            <Loader2 className="animate-spin" />
          </div>
        ) : !items.length ? (
          <Empty text={copy.gallery.empty}>
            <Link href="/" className="btn-primary">
              去画第一张
            </Link>
          </Empty>
        ) : !list.length ? (
          <p className="py-10 text-center text-sm text-muted">没有匹配的内容</p>
        ) : (
          <>
          {picking && (
            <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-rule bg-card px-3 py-2 text-sm shadow-sm" data-testid="gallery-pickbar">
              <span>已选 {picked.size} 项</span>
              <button className="btn-ghost btn-sm" onClick={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map((i) => i.id)))}>
                {picked.size === list.length ? "全不选" : "全选"}
              </button>
              <button className="btn-primary btn-sm ml-auto" disabled={!picked.size || busy} onClick={savePicked} data-testid="gallery-save-picked">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} 保存所选
              </button>
              <button className="btn-danger btn-sm" disabled={!picked.size || busy} onClick={removePicked} data-testid="gallery-del-picked">
                <Trash2 size={13} /> 删除所选
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {list.map((i) => (
              <div
                key={i.id}
                role="button"
                tabIndex={0}
                className={`group card relative cursor-pointer overflow-hidden text-left ${picking && picked.has(i.id) ? "ring-2 ring-acc" : ""}`}
                onClick={() => (picking ? togglePick(i.id) : setView(i))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (picking) togglePick(i.id);
                    else setView(i);
                  }
                }}
                data-testid="gallery-item"
              >
                {picking ? (
                  <span className={`absolute right-2 top-2 z-[1] flex h-6 w-6 items-center justify-center rounded-full border-2 border-white shadow ${picked.has(i.id) ? "bg-acc text-acc-ink" : "bg-black/30"}`}>
                    {picked.has(i.id) && <Check size={14} />}
                  </span>
                ) : (
                  <span className="absolute right-2 top-2 z-[1] flex gap-1 opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                    <button
                      type="button"
                      title="保存到本地"
                      aria-label="保存到本地"
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75"
                      onClick={(e) => {
                        e.stopPropagation();
                        void save(i);
                      }}
                      data-testid="gallery-save"
                    >
                      <Download size={14} />
                    </button>
                    <button
                      type="button"
                      title="从图库删除"
                      aria-label="从图库删除"
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white hover:bg-bad"
                      onClick={(e) => {
                        e.stopPropagation();
                        void remove(i);
                      }}
                      data-testid="gallery-del"
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                )}
                <div className="relative aspect-square overflow-hidden bg-soft">
                  {i.kind === "video" ? (
                    <>
                      {i.poster ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbOf(i.poster, 512)} alt={i.prompt} loading="lazy" decoding="async" className="h-full w-full object-cover transition group-hover:scale-105" />
                      ) : (
                        <video src={`${imgSrc(i.url)}#t=0.1`} preload="metadata" muted playsInline className="h-full w-full object-cover" data-testid="gallery-video-thumb" />
                      )}
                      <span className="absolute inset-0 flex items-center justify-center" data-testid="gallery-video">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white shadow">
                          <Play size={18} fill="currentColor" />
                        </span>
                      </span>
                      <span className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">视频</span>
                    </>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbOf(i.url, 512)} alt={i.prompt} loading="lazy" decoding="async" className="h-full w-full object-cover transition group-hover:scale-105" />
                  )}
                </div>
                <div className="p-2.5">
                  <div className="line-clamp-2 text-xs leading-snug">{i.prompt || "（无提示词）"}</div>
                  <div className="mt-1 truncate text-[11px] text-muted">
                    {i.model} · {fmtTime(i.createdAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
          </>
        )}
      </div>

      <Modal open={!!view} onClose={() => setView(null)} title={view?.kind === "video" ? "视频详情" : "图片详情"} wide>
        {view && (
          <div>
            {view.kind === "video" ? (
              <video
                src={imgSrc(view.url)}
                poster={view.poster ? imgSrc(view.poster) : undefined}
                controls
                playsInline
                preload="metadata"
                className="mx-auto max-h-[60vh] w-full rounded-xl bg-black"
                data-testid="gallery-video-player"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imgSrc(view.url)} alt={view.prompt} className="mx-auto max-h-[60vh] rounded-xl object-contain" />
            )}
            <p className="mt-4 whitespace-pre-wrap text-sm">{view.prompt}</p>
            <p className="mt-1 text-xs text-muted">
              {view.model}
              {view.size && ` · ${view.size}`} · {fmtTime(view.createdAt)}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn-primary btn-sm" onClick={() => void save(view)}>
                <Download size={13} /> 保存到本地
              </button>
              <button className="btn-ghost btn-sm" onClick={() => copyText(view.prompt, "提示词已复制")}>
                <Copy size={13} /> 复制提示词
              </button>
              {view.convId && (
                <Link href={`/c/${view.convId}`} className="btn-ghost btn-sm">
                  <MessageSquare size={13} /> 回到对话
                </Link>
              )}
              <button className="btn-danger btn-sm ml-auto" onClick={() => remove(view)}>
                <Trash2 size={13} /> 删除
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
