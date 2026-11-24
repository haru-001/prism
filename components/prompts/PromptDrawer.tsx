"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Copy, Loader2, MessageSquare, Palette, Pencil, Star, Trash2, X, BookmarkPlus } from "lucide-react";
import { copyText, toast } from "@/components/ui";
import { fillVars, parseVars, splitVars } from "@/lib/prompts/template";
import { addRecent, setChatDraft, setDrawDraft, toggleFav, usePromptDoc } from "@/lib/client/promptlib";
import type { SavedPrompt } from "@/lib/prompts/types";

/** 详情抽屉里显示的一条提示词（灵感库、我的、R18 共用） */
export interface DrawerEntry {
  key: string;
  src: SavedPrompt["src"];
  title: string;
  crumb: string;
  /** 正文；null = 还在加载 */
  text: string | null;
  error?: string;
  /** 同一条的其它语言版本（R18：中文 / English），第一项是 text 本身 */
  langs?: { label: string; text: string; tip?: string }[];
  /** 主图和多图（已经是可以直接显示的地址） */
  images?: string[];
  /** 收藏里存的封面（图床相对路径） */
  coverPath?: string;
  /** 主图比例（如 2:3），用来占位，图片加载时不跳动 */
  ratio?: string;
  badges?: { text: string; acc?: boolean }[];
  /** 要点（R18 中文要点） */
  points?: string[];
  /** 额外说明（反向提示词建议等） */
  note?: React.ReactNode;
  color?: string | null;
}

function aspectOf(r?: string) {
  const m = /^(\d+):(\d+)$/.exec(r || "");
  return m ? `${m[1]} / ${m[2]}` : "4 / 5";
}

export function PromptDrawer({
  entry,
  onClose,
  onPrev,
  onNext,
  onEdit,
  onDelete,
  onSaveAsMine,
}: {
  entry: DrawerEntry;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onSaveAsMine?: (text: string) => void;
}) {
  const router = useRouter();
  const { doc } = usePromptDoc();
  const fav = doc.favs.some((x) => x.key === entry.key);
  const [lang, setLang] = useState(0);
  const [img, setImg] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [vals, setVals] = useState<string[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);

  const raw = entry.langs?.[lang]?.text ?? entry.text ?? "";
  const vars = useMemo(() => parseVars(raw), [raw]);
  // 换了一条：变量、图片、滚动位置都回到开头
  useEffect(() => {
    setImg(0);
    setVals([]);
    bodyRef.current?.scrollTo({ top: 0 });
  }, [entry.key]);
  useEffect(() => setVals(vars.map((v) => v.def)), [vars]);
  const filled = useMemo(() => fillVars(raw, vals), [raw, vals]);

  // 键盘：Esc 关闭，← → 上一条 / 下一条（在输入框里打字时不翻页）
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement | null)?.tagName || "");
      if (e.key === "Escape") {
        if (zoom) setZoom(false);
        else onClose();
        return;
      }
      if (typing) return;
      if (e.key === "ArrowLeft" && onPrev) onPrev();
      if (e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose, onPrev, onNext, zoom]);

  const ready = entry.text != null && !entry.error;
  const saved = (): Omit<SavedPrompt, "time"> => ({ key: entry.key, src: entry.src, title: entry.title, text: filled, img: entry.coverPath, ratio: entry.ratio });

  function draw() {
    if (!ready) return;
    addRecent(saved());
    setDrawDraft({ prompt: filled, ratio: entry.ratio, key: entry.key });
    router.push("/draw");
  }
  function toChat() {
    if (!ready) return;
    addRecent(saved());
    setChatDraft({ text: filled, mode: "image" });
    router.push("/?new=" + Date.now());
  }
  function copy() {
    if (!ready) return;
    addRecent(saved());
    copyText(filled, vars.length ? "已复制（变量已填入）" : "提示词已复制");
  }
  async function star() {
    if (!ready) return;
    try {
      const on = await toggleFav(saved());
      toast(on ? "已收藏" : "已取消收藏", "ok");
    } catch (e) {
      toast("收藏没保存上：" + (e as Error).message, "err");
    }
  }

  const images = entry.images || [];
  const parts = splitVars(raw);

  // 挂到 body 上：抽屉在页面滚动容器里面时，滚轮会带着后面的列表一起滚
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={entry.title}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative flex h-full w-full flex-col bg-card shadow-2xl sm:w-[560px] sm:border-l sm:border-rule" data-testid="prompt-drawer">
        <div className="flex items-center gap-1 border-b border-rule px-3 py-2.5">
          <button className="rounded-lg p-1.5 text-muted hover:bg-hover disabled:opacity-30" onClick={onPrev} disabled={!onPrev} aria-label="上一条" title="上一条（←）">
            <ChevronLeft size={18} />
          </button>
          <button className="rounded-lg p-1.5 text-muted hover:bg-hover disabled:opacity-30" onClick={onNext} disabled={!onNext} aria-label="下一条" title="下一条（→）">
            <ChevronRight size={18} />
          </button>
          <div className="min-w-0 flex-1 truncate px-1 text-xs text-muted">{entry.crumb}</div>
          <button className="rounded-lg p-1.5 text-muted hover:bg-hover" onClick={onClose} aria-label="关闭" title="关闭（Esc）">
            <X size={18} />
          </button>
        </div>

        <div ref={bodyRef} className="scroll-thin flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {images.length > 0 && (
            <>
              <button
                type="button"
                className="relative mx-auto block w-full overflow-hidden rounded-xl bg-soft"
                style={{ aspectRatio: aspectOf(entry.ratio), maxHeight: "52vh", background: entry.color ? `linear-gradient(140deg, ${entry.color}22, ${entry.color}66)` : undefined }}
                onClick={() => setZoom(true)}
                aria-label="查看大图"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img key={images[img]} src={images[img]} alt={entry.title} decoding="async" className="h-full w-full object-contain" />
              </button>
              {images.length > 1 && (
                <div className="scroll-thin mt-2 flex gap-1.5 overflow-x-auto pb-1">
                  {images.map((u, i) => (
                    <button key={u} onClick={() => setImg(i)} className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 ${i === img ? "border-acc" : "border-transparent opacity-70"}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <h2 className="mt-3 text-lg font-bold leading-snug">{entry.title}</h2>
          {!!entry.badges?.length && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {entry.badges.map((b, i) => (
                <span key={i} className={`rounded-md px-1.5 py-0.5 text-[11px] ${b.acc ? "bg-acc/15 text-acc-ink" : "bg-soft text-muted"}`}>
                  {b.text}
                </span>
              ))}
            </div>
          )}
          {!!entry.points?.length && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted">要点</span>
              {entry.points.map((p) => (
                <span key={p} className="rounded-full border border-rule px-2 py-0.5">
                  {p}
                </span>
              ))}
            </div>
          )}

          {entry.langs && entry.langs.length > 1 && (
            <div className="mt-4 inline-flex rounded-xl border border-rule p-0.5 text-xs">
              {entry.langs.map((l, i) => (
                <button key={l.label} onClick={() => setLang(i)} className={`rounded-lg px-3 py-1 ${i === lang ? "bg-soft font-semibold text-acc-ink" : "text-muted"}`}>
                  {l.label}
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-rule bg-soft/60 p-3 text-[13.5px] leading-relaxed" data-testid="prompt-text">
            {entry.error ? (
              <span className="text-bad">{entry.error}</span>
            ) : entry.text == null ? (
              <span className="flex items-center gap-2 text-muted">
                <Loader2 size={14} className="animate-spin" /> 正在加载正文…
              </span>
            ) : (
              parts.map((p, i) =>
                "t" in p ? (
                  <span key={i}>{p.t}</span>
                ) : (
                  <mark key={i} title={p.name} className="rounded bg-acc/20 px-0.5 text-acc-ink">
                    {vals[p.i] || p.def}
                  </mark>
                ),
              )
            )}
          </div>
          {entry.langs?.[lang]?.tip && <p className="mt-2 text-xs leading-relaxed text-muted">{entry.langs[lang].tip}</p>}

          {vars.length > 0 && (
            <div className="mt-4">
              <div className="label">填写变量（复制、去画图时自动填入）</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {vars.map((v, i) => (
                  <label key={i} className="block">
                    <span className="mb-1 block truncate text-[11px] text-muted">{v.name}</span>
                    <input className="input !py-1.5" value={vals[i] ?? ""} placeholder={v.def} onChange={(e) => setVals((a) => a.map((x, k) => (k === i ? e.target.value : x)))} />
                  </label>
                ))}
              </div>
            </div>
          )}
          {entry.note && <div className="mt-4 text-xs leading-relaxed text-muted">{entry.note}</div>}
        </div>

        <div className="border-t border-rule px-4 py-3 sm:px-5">
          <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-1.5 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
            <button className="btn-primary px-2 sm:px-3.5" disabled={!ready} onClick={draw} data-testid="prompt-draw">
              <Palette size={15} /> 用这个画
            </button>
            <button className="btn-ghost px-2 sm:px-3.5" disabled={!ready} onClick={toChat} title="发到对话">
              <MessageSquare size={15} /> <span className="sm:hidden">对话</span>
              <span className="hidden sm:inline">发到对话</span>
            </button>
            <button className="btn-ghost px-2 sm:px-3.5" disabled={!ready} onClick={copy}>
              <Copy size={15} /> 复制
            </button>
            <button className={`btn-ghost px-2 sm:px-3.5 ${fav ? "!text-warn" : ""}`} disabled={!ready} onClick={star} aria-pressed={fav}>
              <Star size={15} fill={fav ? "currentColor" : "none"} /> {fav ? "已收藏" : "收藏"}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {vars.length > 0 && (
              <button className="btn-ghost btn-sm" disabled={!ready} onClick={() => copyText(raw, "已复制原文（含变量）")}>
                复制原文
              </button>
            )}
            {onSaveAsMine && (
              <button className="btn-ghost btn-sm" disabled={!ready} onClick={() => onSaveAsMine(filled)}>
                <BookmarkPlus size={13} /> 存为我的提示词
              </button>
            )}
            {onEdit && (
              <button className="btn-ghost btn-sm" onClick={onEdit}>
                <Pencil size={13} /> 编辑
              </button>
            )}
            {onDelete && (
              <button className="btn-danger btn-sm" onClick={onDelete}>
                <Trash2 size={13} /> 删除
              </button>
            )}
            <span className="ml-auto hidden text-muted sm:inline">← → 翻页 · Esc 关闭</span>
          </div>
        </div>
      </div>

      {zoom && images[img] && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4" onClick={() => setZoom(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={images[img].replace(/\?w=\d+$/, "")} alt={entry.title} className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </div>,
    document.body,
  );
}
