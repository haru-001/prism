"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Columns3, Check, Eye, Film, HelpCircle, ImagePlus, Loader2, MessageSquare, Paperclip, Palette, Square, Thermometer, X, ScrollText, Settings2 } from "lucide-react";
import Link from "next/link";
import type { ModelGroup, Preset } from "@/lib/types";
import type { Picked } from "./ModelPicker";
import { uploadImage } from "@/lib/client/api";
import { copy } from "@/lib/copy";
import { toast } from "../ui";
import { imgSrc } from "@/lib/client/thumb";
import { HF_PRESETS, VIDEO_MODES, VIDEO_PROVIDERS, parseHfChoice, type VideoAspect, type VideoMode, type VideoProvider } from "@/lib/video";

/** 视频模式的选项：子模式、服务（hf:预设 id / hf:custom:… / zhipu）、时长、画面比例、首尾帧图片 */
export interface VideoOpts {
  mode: VideoMode;
  /** 空字符串 = 用设置里的默认 */
  service: string;
  duration: number;
  aspect: VideoAspect;
  /** [首帧/参考图, 尾帧] */
  images: (string | null)[];
}

/** 设置里的视频服务配置（浏览器只拿到打码的 Key 提示） */
export interface VideoCfgView {
  keys: Partial<Record<VideoProvider, { hint: string }>>;
  provider: VideoProvider;
  hfSpace: Record<VideoMode, string>;
}

/** 把选项里的 service 解析成实际提交的 provider / space（空 = 设置里的默认） */
export function resolveService(o: VideoOpts, cfg?: VideoCfgView | null): { provider: VideoProvider; space?: string } {
  const s = o.service;
  if (s === "zhipu") return { provider: "zhipu" };
  if (s.startsWith("hf:")) return { provider: "hf", space: s.slice(3) };
  const provider = cfg?.provider || "hf";
  if (provider === "zhipu" && !VIDEO_PROVIDERS[1].modes.includes(o.mode)) return { provider: "hf", space: cfg?.hfSpace?.[o.mode] };
  return provider === "hf" ? { provider, space: cfg?.hfSpace?.[o.mode] } : { provider };
}

export function serviceLabel(provider: VideoProvider, space: string | undefined, mode: VideoMode) {
  if (provider === "zhipu") return "智谱 CogVideoX-Flash";
  const c = parseHfChoice(space, mode);
  return c.preset ? `HF · ${c.preset.name}` : `HF · ${c.space}`;
}

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
  mode: "chat" | "image" | "video";
  setMode: (m: "chat" | "image" | "video") => void;
  videoOpts?: VideoOpts;
  setVideoOpts?: (f: (o: VideoOpts) => VideoOpts) => void;
  videoCfg?: VideoCfgView | null;
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
  const isVideo = p.mode === "video";
  const popRef = useRef<HTMLDivElement>(null);
  /** 视频模式下这次选的图放进哪一格：0 首帧 / 1 尾帧 */
  const slotRef = useRef(0);
  const vo = p.videoOpts;

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
        if (isVideo && p.setVideoOpts) {
          const slot = slotRef.current;
          p.setVideoOpts((o) => {
            const images = [...o.images];
            images[slot] = url;
            return { ...o, images };
          });
          slotRef.current = Math.min(1, slot + 1);
        } else if (isImage) p.setImageOpts((o) => ({ ...o, refs: [...o.refs, url].slice(-4) }));
        else p.setAttachments((a) => [...a, url].slice(-6));
      } catch (e) {
        toast((e as Error).message, "err");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  const thumbs = isVideo ? [] : isImage ? p.imageOpts.refs : p.attachments;
  const removeThumb = (u: string) =>
    isImage ? p.setImageOpts((o) => ({ ...o, refs: o.refs.filter((x) => x !== u) })) : p.setAttachments((a) => a.filter((x) => x !== u));

  // 视频：要的图得齐；文生视频必须写描述，图生 / 首尾帧可以不写（用 Space 的默认描述）
  const vMode = VIDEO_MODES.find((m) => m.id === vo?.mode);
  const vImagesOk = !isVideo || !vMode || vo!.images.slice(0, vMode.images).filter(Boolean).length >= vMode.images;
  const canSend = (isVideo ? !!p.input.trim() || (!!vMode && vMode.images > 0) : !!p.input.trim()) && vImagesOk && !uploading;
  const vSel = isVideo && vo ? resolveService(vo, p.videoCfg) : null;
  const vPreset = vSel?.provider === "hf" ? parseHfChoice(vSel.space, vo!.mode).preset : undefined;
  const vMaxSec = vPreset?.maxSec ?? 6;
  const vNoKey = !!vSel && p.videoCfg !== undefined && p.videoCfg !== null && !p.videoCfg.keys[vSel.provider];

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
          {p.setVideoOpts && (
            <button
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${isVideo ? "bg-card text-ink shadow-sm" : "text-muted"}`}
              onClick={() => p.setMode("video")}
              data-testid="mode-video"
            >
              <Film size={13} /> 视频
            </button>
          )}
        </div>

        {isVideo && vo && p.setVideoOpts ? (
          <>
            <div className="flex rounded-xl border border-rule p-0.5" role="radiogroup" aria-label="视频模式">
              {VIDEO_MODES.map((m) => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={vo.mode === m.id}
                  data-testid={`vmode-${m.id}`}
                  className={`rounded-lg px-2 py-0.5 text-xs transition ${vo.mode === m.id ? "bg-acc/15 font-semibold text-acc-ink" : "text-muted hover:text-ink"}`}
                  onClick={() => p.setVideoOpts!((o) => ({ ...o, mode: m.id, service: o.service === "zhipu" && m.id === "flf" ? "" : o.service.startsWith("hf:") ? "" : o.service }))}
                >
                  {m.name}
                </button>
              ))}
            </div>
            <select
              className="chip max-w-[46vw] cursor-pointer outline-none sm:max-w-[260px]"
              value={vo.service}
              data-testid="video-service"
              title="用哪个视频服务"
              onChange={(e) => p.setVideoOpts!((o) => ({ ...o, service: e.target.value }))}
            >
              <option value="">默认（{vSel && !vo.service ? serviceLabel(vSel.provider, vSel.space, vo.mode) : "设置里选的"}）</option>
              {HF_PRESETS.filter((x) => x.mode === vo.mode).map((x) => (
                <option key={x.id} value={`hf:${x.id}`}>
                  HF · {x.name}
                </option>
              ))}
              {p.videoCfg?.hfSpace?.[vo.mode]?.startsWith("custom:") && (
                <option value={`hf:${p.videoCfg.hfSpace[vo.mode]}`}>HF · {p.videoCfg.hfSpace[vo.mode].slice(7).split("#")[0]}（自填）</option>
              )}
              {VIDEO_PROVIDERS[1].modes.includes(vo.mode) && <option value="zhipu">智谱 CogVideoX-Flash（免费）</option>}
            </select>
            {vSel?.provider === "hf" && (
              <select
                className="chip cursor-pointer outline-none"
                value={Math.min(vo.duration, vMaxSec)}
                data-testid="video-duration"
                title="视频时长：越长越慢，也越耗 GPU 额度"
                onChange={(e) => p.setVideoOpts!((o) => ({ ...o, duration: Number(e.target.value) }))}
              >
                {[2, 3, 4, 5, 6, 8].filter((n) => n <= vMaxSec).map((n) => (
                  <option key={n} value={n}>
                    {n} 秒
                  </option>
                ))}
              </select>
            )}
            {vo.mode === "t2v" && (
              <select className="chip cursor-pointer outline-none" value={vo.aspect} onChange={(e) => p.setVideoOpts!((o) => ({ ...o, aspect: e.target.value as VideoAspect }))}>
                <option value="16:9">16:9 横屏</option>
                <option value="9:16">9:16 竖屏</option>
                <option value="1:1">1:1 方形</option>
              </select>
            )}
            <Link href="/settings#video" className="chip" title="视频服务的 Key、Space 和使用说明">
              <HelpCircle size={13} /> 说明
            </Link>
          </>
        ) : isImage ? (
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

      {!isImage && !isVideo && p.visionNotice && thumbs.length > 0 && <div className="mb-2">{p.visionNotice}</div>}

      {isVideo && vo && vMode && vMode.images > 0 && (
        <div className="mb-2 flex flex-wrap items-end gap-2" data-testid="video-slots">
          {Array.from({ length: vMode.images }).map((_, i) => {
            const u = vo.images[i];
            const label = vMode.images === 2 ? (i === 0 ? "首帧" : "尾帧") : "参考图";
            return (
              <div key={i} className="flex flex-col items-center gap-1">
                {u ? (
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imgSrc(u)} alt={label} className="h-16 w-16 rounded-lg border border-rule object-cover" />
                    <button
                      className="absolute -right-1.5 -top-1.5 rounded-full bg-ink p-0.5 text-ground"
                      aria-label={`移除${label}`}
                      onClick={() =>
                        p.setVideoOpts!((o) => {
                          const images = [...o.images];
                          images[i] = null;
                          return { ...o, images };
                        })
                      }
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-rule text-[11px] text-muted hover:border-acc hover:text-acc-ink"
                    data-testid={`video-slot-${i}`}
                    onClick={() => {
                      slotRef.current = i;
                      p.fileInputRef.current?.click();
                    }}
                  >
                    <ImagePlus size={16} />
                    {label}
                  </button>
                )}
                <span className="text-[10px] text-muted">{label}</span>
              </div>
            );
          })}
          {uploading > 0 && (
            <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-rule text-muted">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}
          <p className="mb-5 min-w-0 flex-1 text-[11px] leading-snug text-muted">
            {vMode.images === 2 ? "放开头和结尾两张图，描述写中间发生了什么。" : "放一张图，描述写它要怎么动；不写描述就让画面自然动起来。"}
            {vSel?.provider === "zhipu" ? " 图片会压缩成 JPEG 后交给智谱。" : " 图片会先上传到 Space 的临时目录。"}
          </p>
        </div>
      )}

      {isVideo && vNoKey && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-warn/10 px-3 py-2 text-xs text-ink/80" data-testid="video-nokey">
          <span className="min-w-0 flex-1">
            还没有添加{vSel!.provider === "hf" ? " Hugging Face 令牌" : "智谱 API Key"}，提交后会直接失败。
          </span>
          <Link href="/settings#video" className="btn-ghost btn-sm">
            去添加
          </Link>
        </div>
      )}

      {!isVideo && (thumbs.length > 0 || uploading > 0) && (
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
          placeholder={isVideo ? copy.chat.placeholderVideo : isImage ? copy.chat.placeholderImage : copy.chat.placeholder}
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
