"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Columns3, Check, Eye, ImagePlus, Loader2, MessageSquare, Paperclip, Palette, Square, Thermometer, X, ScrollText, Settings2 } from "lucide-react";
import Link from "next/link";
import type { ModelGroup, Preset } from "@/lib/types";
import type { Picked } from "./ModelPicker";
import { uploadImage } from "@/lib/client/api";
import { copy } from "@/lib/copy";
import { toast } from "../ui";
import { imgSrc } from "@/lib/client/thumb";

export interface ImageOpts {
  size: string;
  n: number;
  quality: "" | "low" | "medium" | "high";
  refs: string[];
}

const SIZES = [
  { v: "1024x1024", l: "1:1 方图" },
  { v: "1024x1536", l: "2:3 竖图" },
  { v: "1536x1024", l: "3:2 横图" },
  { v: "auto", l: "自动" },
];
const QUALITY = [
  { v: "", l: "默认质量" },
  { v: "low", l: "低（快）" },
  { v: "medium", l: "中" },
  { v: "high", l: "高" },
];

function Num({ n }: { n: number }) {
  return <span className="num shadow">{["①", "②", "③"][n - 1] ? n : n}</span>;
}

export function Composer(p: {
  mode: "chat" | "image";
  setMode: (m: "chat" | "image") => void;
  input: string;
  setInput: (s: string) => void;
  attachments: string[];
  setAttachments: (f: (a: string[]) => string[]) => void;
  imageOpts: ImageOpts;
  setImageOpts: (f: (o: ImageOpts) => ImageOpts) => void;
  system: string;
  setSystem: (s: string) => void;
  temperature: number;
  setTemperature: (n: number) => void;
  streaming: boolean;
  onSend: () => void;
  onStop: () => void;
  showNums: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  textRef: React.RefObject<HTMLTextAreaElement | null>;
  /** 提示词预设 */
  presets?: Preset[];
  onApplyPreset?: (p: Preset) => void;
  /** 并排对比：主模型之外再挑最多 3 个 */
  catalog?: ModelGroup[];
  primary?: Picked;
  compare?: Picked[];
  setCompare?: (f: (c: Picked[]) => Picked[]) => void;
  /** 附了图但当前模型不支持识图时的提示 */
  visionNotice?: React.ReactNode;
}) {
  const [uploading, setUploading] = useState(0);
  const [pop, setPop] = useState<"" | "system" | "temp" | "compare">("");
  const compare = p.compare || [];
  const sameModel = (a: Picked, b?: Picked) => !!b && a.model === b.model && (a.channelId || "") === (b.channelId || "");
  const [drag, setDrag] = useState(false);
  const isImage = p.mode === "image";
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = p.textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [p.input, p.textRef]);

  useEffect(() => {
    if (!pop) return;
    const on = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setPop("");
    };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, [pop]);

  async function addFiles(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setUploading((n) => n + imgs.length);
    for (const f of imgs) {
      try {
        const url = await uploadImage(f);
        if (isImage) p.setImageOpts((o) => ({ ...o, refs: [...o.refs, url].slice(-4) }));
        else p.setAttachments((a) => [...a, url].slice(-6));
      } catch (e) {
        toast((e as Error).message, "err");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  const thumbs = isImage ? p.imageOpts.refs : p.attachments;
  const removeThumb = (u: string) =>
    isImage ? p.setImageOpts((o) => ({ ...o, refs: o.refs.filter((x) => x !== u) })) : p.setAttachments((a) => a.filter((x) => x !== u));

  const canSend = !!p.input.trim() && !uploading;

  return (
    <div
      className={`card relative p-2.5 shadow-lg transition ${drag ? "ring-2 ring-acc" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void addFiles([...e.dataTransfer.files]);
      }}
    >
      <input
        ref={p.fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void addFiles([...(e.target.files || [])]);
          e.target.value = "";
        }}
      />

      {/* 顶部：模式切换 + 选项 */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5" ref={popRef}>
        <div className="relative flex rounded-xl bg-soft p-0.5">
          {p.showNums && (
            <span className="absolute -left-2 -top-2 z-10">
              <Num n={2} />
            </span>
          )}
          <button
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${!isImage ? "bg-card text-ink shadow-sm" : "text-muted"}`}
            onClick={() => p.setMode("chat")}
          >
            <MessageSquare size={13} /> 对话
          </button>
          <button
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${isImage ? "bg-card text-ink shadow-sm" : "text-muted"}`}
            onClick={() => p.setMode("image")}
          >
            <Palette size={13} /> 生图
          </button>
        </div>

        {isImage ? (
          <>
            <button className="chip" onClick={() => p.fileInputRef.current?.click()}>
              <ImagePlus size={13} /> 参考图
            </button>
            <select className="chip cursor-pointer outline-none" value={p.imageOpts.size} onChange={(e) => p.setImageOpts((o) => ({ ...o, size: e.target.value }))}>
              {SIZES.map((s) => (
                <option key={s.v} value={s.v}>
                  {s.l}
                </option>
              ))}
            </select>
            <select className="chip cursor-pointer outline-none" value={p.imageOpts.n} onChange={(e) => p.setImageOpts((o) => ({ ...o, n: Number(e.target.value) }))}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} 张
                </option>
              ))}
            </select>
            <select
              className="chip cursor-pointer outline-none"
              value={p.imageOpts.quality}
              onChange={(e) => p.setImageOpts((o) => ({ ...o, quality: e.target.value as ImageOpts["quality"] }))}
            >
              {QUALITY.map((s) => (
                <option key={s.v} value={s.v}>
                  {s.l}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <button className="chip" onClick={() => p.fileInputRef.current?.click()} title="附图片给模型识别">
              <Paperclip size={13} /> 图片
            </button>
            <div className="relative">
              <button className={`chip ${p.system ? "!text-acc-ink" : ""}`} onClick={() => setPop(pop === "system" ? "" : "system")}>
                <ScrollText size={13} /> 系统提示词{p.system ? " · 已设" : ""}
              </button>
              {pop === "system" && (
                <div className="card absolute bottom-full left-0 z-30 mb-2 w-[min(86vw,360px)] p-3 shadow-2xl">
                  {!!p.presets?.length && (
                    <>
                      <div className="label">套用预设</div>
                      <div className="mb-2.5 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                        {p.presets.map((ps) => (
                          <button
                            key={ps.id}
                            className={`chip ${p.system === ps.system ? "!border-acc !text-acc-ink" : ""}`}
                            onClick={() => p.onApplyPreset?.(ps)}
                            title={ps.system.slice(0, 120)}
                          >
                            {ps.name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="label">本对话的系统提示词</div>
                  <textarea
                    className="input min-h-28"
                    value={p.system}
                    placeholder="比如：你是一位严谨的代码审查员…"
                    onChange={(e) => p.setSystem(e.target.value)}
                  />
                  <Link href="/settings#presets" className="mt-2 inline-flex items-center gap-1 text-xs text-muted hover:text-acc-ink">
                    <Settings2 size={12} /> 管理提示词预设
                  </Link>
                </div>
              )}
            </div>
            <div className="relative">
              <button className="chip" onClick={() => setPop(pop === "temp" ? "" : "temp")}>
                <Thermometer size={13} /> 温度 {p.temperature.toFixed(1)}
              </button>
              {pop === "temp" && (
                <div className="card absolute bottom-full left-0 z-30 mb-2 w-56 p-3 shadow-2xl">
                  <div className="label">温度：越高越发散，越低越稳定</div>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.1}
                    value={p.temperature}
                    onChange={(e) => p.setTemperature(Number(e.target.value))}
                    className="w-full accent-[var(--acc)]"
                  />
                </div>
              )}
            </div>
            {p.setCompare && (
              <div className="relative">
                <button
                  className={`chip ${compare.length ? "!border-acc !text-acc-ink" : ""}`}
                  onClick={() => setPop(pop === "compare" ? "" : "compare")}
                  title="同一个问题让多个模型并排回答"
                >
                  <Columns3 size={13} /> 并排{compare.length ? ` · ${compare.length + 1} 个模型` : ""}
                </button>
                {pop === "compare" && (
                  <div className="card absolute bottom-full right-0 z-30 mb-2 w-[min(86vw,340px)] p-3 shadow-2xl sm:left-0 sm:right-auto">
                    <div className="label">再挑最多 3 个模型，和当前模型并排回答</div>
                    <div className="scroll-thin max-h-64 overflow-y-auto pr-1">
                      {(p.catalog || [])
                        .filter((g) => !g.disabled)
                        .map((g) => {
                          const models = g.models.filter((m) => !m.caps.includes("image"));
                          if (!models.length) return null;
                          return (
                            <div key={g.channelId} className="mb-2">
                              <div className="mb-1 text-[11px] font-semibold text-muted">{g.channelName}</div>
                              {models.map((m) => {
                                const it = { model: m.id, channelId: g.channelId };
                                const isPrimary = sameModel(it, p.primary);
                                const on = isPrimary || compare.some((c) => sameModel(c, it));
                                const full = !on && compare.length >= 3;
                                return (
                                  <button
                                    key={m.id}
                                    data-testid="compare-option"
                                    disabled={isPrimary || full}
                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-soft disabled:opacity-50"
                                    onClick={() =>
                                      p.setCompare!((c) => (c.some((x) => sameModel(x, it)) ? c.filter((x) => !sameModel(x, it)) : [...c, it].slice(0, 3)))
                                    }
                                  >
                                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-acc bg-acc text-white" : "border-rule"}`}>
                                      {on && <Check size={11} />}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate">{m.id}</span>
                                    {m.caps.includes("vision") && <Eye size={12} className="shrink-0 text-muted" aria-label="识图" />}
                                    {isPrimary && <span className="text-[11px] text-muted">当前</span>}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-muted">{compare.length ? `已选 ${compare.length} 个` : "没选就是普通单模型对话"}</span>
                      {compare.length > 0 && (
                        <button className="text-xs font-semibold text-acc-ink" onClick={() => p.setCompare!(() => [])}>
                          清空
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {!isImage && p.visionNotice && thumbs.length > 0 && <div className="mb-2">{p.visionNotice}</div>}

      {(thumbs.length > 0 || uploading > 0) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {thumbs.map((u) => (
            <div key={u} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imgSrc(u)} alt="" className="h-16 w-16 rounded-lg border border-rule object-cover" />
              <button className="absolute -right-1.5 -top-1.5 rounded-full bg-ink p-0.5 text-ground" onClick={() => removeThumb(u)} aria-label="移除">
                <X size={12} />
              </button>
            </div>
          ))}
          {uploading > 0 && (
            <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-rule text-muted">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}
        </div>
      )}

      <div className="relative flex items-end gap-2">
        {p.showNums && (
          <span className="absolute -left-2 -top-2 z-10">
            <Num n={3} />
          </span>
        )}
        <textarea
          ref={p.textRef}
          rows={1}
          value={p.input}
          onChange={(e) => p.setInput(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!p.streaming && canSend) p.onSend();
            }
          }}
          placeholder={isImage ? copy.chat.placeholderImage : copy.chat.placeholder}
          className="scroll-thin max-h-60 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] leading-relaxed outline-none placeholder:text-muted"
        />
        {p.streaming ? (
          <button className="mb-1 flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-ground" onClick={p.onStop} aria-label="停止">
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            className="grad mb-1 flex h-9 w-9 items-center justify-center rounded-xl text-white shadow disabled:opacity-40"
            disabled={!canSend}
            onClick={p.onSend}
            aria-label="发送"
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
