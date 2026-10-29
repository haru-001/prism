"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Copy, Download, Loader2, MessageSquare, Search, Trash2 } from "lucide-react";
import { Empty, Modal, PageHeader, copyText, toast } from "@/components/ui";
import { api, fmtTime } from "@/lib/client/api";
import { copy } from "@/lib/copy";
import type { GalleryItem } from "@/lib/types";

function download(item: GalleryItem) {
  const a = document.createElement("a");
  a.href = item.url;
  a.download = `prism-${item.id}.png`;
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

  useEffect(() => {
    api<{ items: GalleryItem[] }>("/api/gallery")
      .then((r) => setItems(r.items))
      .catch((e) => {
        toast((e as Error).message, "err");
        setItems([]);
      });
  }, []);

  async function remove(item: GalleryItem) {
    if (!confirm("从图库里删除这张图？对话里的记录不受影响。")) return;
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
    return (items || []).filter((i) => !kw || i.prompt.toLowerCase().includes(kw) || i.model.toLowerCase().includes(kw));
  }, [items, q]);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader
        title="图库"
        sub={items ? `共 ${items.length} 张` : undefined}
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
          <p className="py-10 text-center text-sm text-muted">没有匹配的图片</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {list.map((i) => (
              <button key={i.id} className="group card overflow-hidden text-left" onClick={() => setView(i)}>
                <div className="aspect-square overflow-hidden bg-soft">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={i.url} alt={i.prompt} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
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

      <Modal open={!!view} onClose={() => setView(null)} title="图片详情" wide>
        {view && (
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={view.url} alt={view.prompt} className="mx-auto max-h-[60vh] rounded-xl object-contain" />
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
