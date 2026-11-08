"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Copy, Download, Film, Loader2, MessageSquare, Play, Search, Trash2 } from "lucide-react";
import { Empty, Modal, PageHeader, copyText, toast } from "@/components/ui";
import { api, fmtTime } from "@/lib/client/api";
import { imgSrc, thumbOf } from "@/lib/client/thumb";
import { copy, fill } from "@/lib/copy";
import type { GalleryItem } from "@/lib/types";
import { RinnePageHead } from "@/components/rinne/RinnePageHead";


function download(item: GalleryItem) {
  const a = document.createElement("a");
  a.href = imgSrc(item.url);
  a.download = `prism-${item.id}.${item.kind === "video" ? "mp4" : "png"}`;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
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
        sub={items ? (videos ? `共 ${items.length - videos} 张图、${videos} 段视频` : `共 ${items.length} 张`) : undefined}
        right={
          items && items.length > 0 ? (
            <label className="flex w-44 items-center gap-2 rounded-xl border border-rule bg-card px-3 py-1.5 sm:w-60">
              <Search size={14} className="text-muted" />
              <input className="w-full bg-transparent text-sm outline-none placeholder:text-muted" placeholder="搜索提示词" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
          ) : undefined
        }
      />
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
        {items && items.length > 0 && (
          <div className="mb-6">
            <RinnePageHead page="gallery">{videos ? fill(copy.gallery.sayVideo, { n: items.length - videos, v: videos }) : fill(copy.gallery.say, { n: items.length })}</RinnePageHead>
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {list.map((i) => (
              <button key={i.id} className="group card overflow-hidden text-left" onClick={() => setView(i)}>
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
              </button>
            ))}
          </div>
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
              <button className="btn-primary btn-sm" onClick={() => download(view)}>
                <Download size={13} /> 下载
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
