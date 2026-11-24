"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, ExternalLink, Palette, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { copyText, toast } from "@/components/ui";
import { thumbOf } from "@/lib/client/thumb";
import { fmtTime } from "@/lib/client/api";
import {
  addRecent,
  coverUrl,
  downloadText,
  saveFavs,
  saveItems,
  setDrawDraft,
  setRecent,
  useLibPrefs,
  usePromptDoc,
  useRecent,
} from "@/lib/client/promptlib";
import type { LibManifest, SavedPrompt, UserPrompt } from "@/lib/prompts/types";
import { PromptDrawer, type DrawerEntry } from "./PromptDrawer";

const SRC_LABEL: Record<SavedPrompt["src"], string> = { sx: "灵感库", my: "我的", r18: "R18", as: "R18" };

/** 我的提示词 */
export function MineGrid({ onEdit, loaded }: { onEdit: (p?: Partial<UserPrompt>) => void; loaded: boolean }) {
  const { doc } = usePromptDoc();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const cats = useMemo(() => Array.from(new Set(doc.items.map((x) => x.category || "").filter(Boolean))), [doc.items]);
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return [...doc.items]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((x) => (!cat || x.category === cat) && (!k || `${x.title} ${x.prompt} ${x.category || ""}`.toLowerCase().includes(k)));
  }, [doc.items, q, cat]);
  const pos = open ? list.findIndex((x) => x.id === open) : -1;
  const cur = pos >= 0 ? list[pos] : null;

  async function remove(p: UserPrompt) {
    if (!confirm(`删除「${p.title}」？`)) return;
    setOpen(null);
    try {
      await saveItems(doc.items.filter((x) => x.id !== p.id));
      toast("已删除", "ok");
    } catch (e) {
      toast("删除失败：" + (e as Error).message, "err");
    }
  }

  const entry: DrawerEntry | null = cur
    ? {
        key: "my:" + cur.id,
        src: "my",
        title: cur.title,
        crumb: `我的提示词${cur.category ? " / " + cur.category : ""}`,
        text: cur.prompt,
        images: cur.cover ? [thumbOf(cur.cover, 1024)] : undefined,
        ratio: cur.ratio,
        badges: [...(cur.category ? [{ text: cur.category }] : []), ...(cur.ratio ? [{ text: `建议比例 ${cur.ratio}`, acc: true }] : []), { text: `更新于 ${fmtTime(cur.updatedAt)}` }],
      }
    : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-rule bg-card px-3 py-2 sm:max-w-sm">
          <Search size={15} className="text-muted" />
          <input className="w-full bg-transparent text-sm outline-none placeholder:text-muted" placeholder="搜索我的提示词" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button className="btn-primary" onClick={() => onEdit()} data-testid="prompt-new">
          <Plus size={15} /> 新建提示词
        </button>
      </div>
      {cats.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button className={`chip ${!cat ? "chip-on" : ""}`} onClick={() => setCat("")}>
            全部
          </button>
          {cats.map((c) => (
            <button key={c} className={`chip ${cat === c ? "chip-on" : ""}`} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      {!loaded && !doc.items.length ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="shimmer h-40 rounded-2xl" />
          ))}
        </div>
      ) : !list.length ? (
        <div className="card mt-4 px-6 py-12 text-center text-sm text-muted">
          {doc.items.length ? "没有匹配的提示词" : "还没有自己的提示词。点「新建提示词」写一条，或在灵感库里把喜欢的一条「存为我的提示词」再改。"}
          <p className="mt-2 text-xs">支持变量写法 {'{argument name="角色" default="少女"}'}，用的时候会变成填空。</p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((p) => (
            <button key={p.id} className="card group overflow-hidden text-left transition hover:-translate-y-0.5 hover:shadow-md" onClick={() => setOpen(p.id)} data-testid="mine-card">
              <div className="relative aspect-[4/3] overflow-hidden bg-soft">
                {p.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbOf(p.cover, 512)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                ) : (
                  <div className="grad flex h-full w-full items-end p-3 opacity-90">
                    <span className="line-clamp-3 text-xs leading-snug text-white/90">{p.prompt}</span>
                  </div>
                )}
              </div>
              <div className="p-2.5">
                <div className="truncate text-[13px] font-medium">{p.title}</div>
                <div className="mt-0.5 truncate text-[11px] text-muted">
                  {p.category || "未分类"}
                  {p.ratio ? ` · ${p.ratio}` : ""}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {entry && cur && (
        <PromptDrawer
          entry={entry}
          onClose={() => setOpen(null)}
          onPrev={pos > 0 ? () => setOpen(list[pos - 1].id) : undefined}
          onNext={pos < list.length - 1 ? () => setOpen(list[pos + 1].id) : undefined}
          onEdit={() => {
            setOpen(null);
            onEdit(cur);
          }}
          onDelete={() => void remove(cur)}
        />
      )}
    </div>
  );
}

/** 收藏 / 最近使用（haru 的「收藏」页）：可搜索、复制、去画图、回到原条目、导出备份 */
export function SavedList({ kind, manifest, onOpenSx }: { kind: "fav" | "recent"; manifest: LibManifest; onOpenSx: (id: number) => void }) {
  const router = useRouter();
  const prefs = useLibPrefs();
  const { doc } = usePromptDoc();
  const recent = useRecent();
  const all = kind === "fav" ? doc.favs : recent;
  const [q, setQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return all.filter((x) => (prefs.adult || (x.src !== "r18" && x.src !== "as")) && (!k || `${x.title} ${x.text}`.toLowerCase().includes(k)));
  }, [all, q, prefs.adult]);

  function remove(key: string) {
    if (kind === "fav") void saveFavs(doc.favs.filter((x) => x.key !== key)).catch((e) => toast((e as Error).message, "err"));
    else setRecent(recent.filter((x) => x.key !== key));
  }
  function clear() {
    if (!confirm(kind === "fav" ? "清空全部收藏？" : "清空最近使用记录？")) return;
    if (kind === "fav") void saveFavs([]).catch((e) => toast((e as Error).message, "err"));
    else setRecent([]);
  }
  function draw(x: SavedPrompt) {
    addRecent(x);
    setDrawDraft({ prompt: x.text, ratio: x.ratio, key: x.key });
    router.push("/draw");
  }
  function backup() {
    downloadText(
      `prism-prompts-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ type: "prism-prompts", version: 1, time: new Date().toISOString(), items: doc.items, favs: doc.favs, recent }, null, 1),
    );
  }
  async function restore(f: File) {
    try {
      const j = JSON.parse(await f.text()) as { items?: UserPrompt[]; favs?: SavedPrompt[]; fav?: SavedPrompt[]; recent?: SavedPrompt[]; hist?: SavedPrompt[] };
      // 也认 haru 的备份格式（fav / hist）
      const favIn = j.favs || j.fav || [];
      const recIn = j.recent || j.hist || [];
      const keys = new Set(doc.favs.map((x) => x.key));
      const ids = new Set(doc.items.map((x) => x.id));
      const items = (j.items || []).filter((x) => x?.id && !ids.has(x.id));
      const favs = favIn.filter((x) => x?.key && !keys.has(x.key));
      if (items.length) await saveItems([...doc.items, ...items]);
      if (favs.length) await saveFavs([...doc.favs, ...favs]);
      const rk = new Set(recent.map((x) => x.key));
      const rec = recIn.filter((x) => x?.key && !rk.has(x.key));
      if (rec.length) setRecent([...recent, ...rec]);
      toast(`导入完成：提示词 ${items.length} 条、收藏 ${favs.length} 条、最近 ${rec.length} 条`, "ok");
    } catch {
      toast("文件格式不对", "err");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-rule bg-card px-3 py-2 sm:max-w-sm">
          <Search size={15} className="text-muted" />
          <input className="w-full bg-transparent text-sm outline-none placeholder:text-muted" placeholder={kind === "fav" ? "搜索收藏" : "搜索最近使用"} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <span className="text-xs text-muted">{list.length} 条</span>
        <div className="ml-auto flex gap-1.5">
          <button className="btn-ghost btn-sm" onClick={backup} title="导出我的提示词、收藏和最近使用">
            <Download size={13} /> 导出
          </button>
          <button className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()} title="导入备份（也支持 haru 的备份文件）">
            <Upload size={13} /> 导入
          </button>
          {all.length > 0 && (
            <button className="btn-danger btn-sm" onClick={clear}>
              <Trash2 size={13} /> 清空
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void restore(f);
            }}
          />
        </div>
      </div>
      {kind === "recent" && <p className="mt-2 text-xs text-muted">最近使用只记在这台设备上（复制、去画图、发到对话都会记一笔）；收藏和我的提示词保存在服务器上，换设备也在。</p>}
      {!list.length ? (
        <div className="card mt-4 px-6 py-12 text-center text-sm text-muted">{kind === "fav" ? "还没有收藏，去灵感库挑几条吧" : "还没有使用记录"}</div>
      ) : (
        <div className="mt-4 space-y-2">
          {list.map((x) => (
            <div key={x.key} className="card flex gap-3 p-2.5" data-testid="saved-item">
              <div className="flex h-16 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-soft text-xs text-muted">
                {x.img && x.src === "sx" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverUrl(manifest, x.img, 360, prefs.cover)} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  SRC_LABEL[x.src]
                )}
              </div>
              <button className="min-w-0 flex-1 text-left" onClick={() => copyText(x.text)} title="点击复制">
                <div className="truncate text-[13px] font-medium">{x.title || x.text.slice(0, 40)}</div>
                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">{x.text}</p>
                <p className="mt-0.5 text-[11px] text-muted/80">
                  {SRC_LABEL[x.src]} · {fmtTime(x.time)}
                  {x.ratio ? ` · ${x.ratio}` : ""}
                </p>
              </button>
              <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
                <button className="btn-ghost btn-sm" onClick={() => copyText(x.text)} aria-label="复制">
                  <Copy size={13} />
                  <span className="hidden sm:inline">复制</span>
                </button>
                <button className="btn-primary btn-sm" onClick={() => draw(x)}>
                  <Palette size={13} />
                  <span className="hidden sm:inline">去画图</span>
                </button>
                {x.src === "sx" && (
                  <button className="btn-ghost btn-sm hidden sm:inline-flex" onClick={() => onOpenSx(Number(x.key.slice(3)))}>
                    <ExternalLink size={13} /> 原条目
                  </button>
                )}
                <button className="rounded-lg p-1 text-muted hover:text-bad" onClick={() => remove(x.key)} aria-label="移除">
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
