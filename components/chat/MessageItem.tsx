"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Brain, ChevronDown, Copy, Download, PencilLine, RefreshCw, TriangleAlert } from "lucide-react";
import type { ChatMsg } from "@/lib/types";
import { fmtMs } from "@/lib/client/api";
import { copy as C, fill } from "@/lib/copy";
import { useApp } from "../AppContext";
import { imgSrc, thumbOf } from "@/lib/client/thumb";
import { IdolAvatar } from "../Logo";
import { RinneInline } from "../rinne/RinneInline";
import { ModelAvatar, copyText, toast } from "../ui";

/**
 * Markdown 渲染（含代码高亮）体积大，单独拆包按需加载：欢迎页不用下载它，
 * ChatView 挂载后会在空闲时预加载；没加载完之前先显示纯文本，不会空白。
 * 不用 React.lazy：它每次首次渲染都要挂起一下，React 会把显示推迟约 300ms。
 */
type MdComp = (typeof import("../Markdown"))["Markdown"];
let MD: MdComp | null = null;
let mdLoading: Promise<unknown> | null = null;
const mdWaiters = new Set<() => void>();
export function loadMarkdown() {
  mdLoading ??= import("../Markdown").then((m) => {
    MD = m.Markdown;
    mdWaiters.forEach((f) => f());
    mdWaiters.clear();
  });
  return mdLoading;
}
function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const [ready, setReady] = useState(!!MD);
  useEffect(() => {
    // 渲染和这里之间模块可能刚好加载完，补一次
    if (MD) return void setReady(true);
    const f = () => setReady(true);
    mdWaiters.add(f);
    void loadMarkdown().catch(() => {});
    return () => void mdWaiters.delete(f);
  }, []);
  const C = ready || MD ? MD : null;
  return C ? <C text={text} streaming={streaming} /> : <div className="md whitespace-pre-wrap">{text}</div>;
}

export async function downloadImage(raw: string) {
  const url = imgSrc(raw);
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
    a.download = `prism-${Date.now()}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch {
    window.open(url, "_blank");
  }
}

export function ImageGrid({
  urls,
  onEdit,
  onRegen,
  small,
}: {
  urls: string[];
  onEdit?: (url: string) => void;
  onRegen?: () => void;
  small?: boolean;
}) {
  return (
    <div className={`grid gap-2 ${urls.length > 1 ? "grid-cols-2" : "grid-cols-1"} ${small ? "max-w-[220px]" : "max-w-[520px]"}`}>
      {urls.map((u, i) => (
        <div key={u + i} className="group relative overflow-hidden rounded-xl border border-rule bg-soft">
          <a href={imgSrc(u)} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbOf(u, small || urls.length > 1 ? 512 : 1024)} alt="" className="block h-auto w-full object-cover" loading="lazy" decoding="async" />
          </a>
          {!small && (
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
              <button className="rounded-lg bg-white/90 px-2 py-1 text-xs text-[#1b1830] hover:bg-white" onClick={() => downloadImage(u)}>
                <Download size={12} className="mr-1 inline" />
                下载
              </button>
              {onRegen && (
                <button className="rounded-lg bg-white/90 px-2 py-1 text-xs text-[#1b1830] hover:bg-white" onClick={onRegen}>
                  <RefreshCw size={12} className="mr-1 inline" />
                  重新生成
                </button>
              )}
              {onEdit && (
                <button className="rounded-lg bg-white/90 px-2 py-1 text-xs text-[#1b1830] hover:bg-white" onClick={() => onEdit(u)}>
                  <PencilLine size={12} className="mr-1 inline" />
                  以此继续改
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function Coach({ children, onOk }: { children: React.ReactNode; onOk: () => void }) {
  return (
    <div className="coach">
      <IdolAvatar size={26} />
      <div className="flex-1">{children}</div>
      <button className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-semibold hover:bg-white/25" onClick={onOk}>
        {C.chat.gotIt}
      </button>
    </div>
  );
}

export function MessageItem({
  m,
  isLast,
  streaming,
  onRegenerate,
  onEditImage,
  onRegenImage,
  firstErrorTip,
  onFirstErrorSeen,
}: {
  m: ChatMsg;
  isLast: boolean;
  streaming: boolean;
  onRegenerate?: () => void;
  onEditImage?: (url: string) => void;
  onRegenImage?: () => void;
  firstErrorTip?: boolean;
  onFirstErrorSeen?: () => void;
}) {
  const [showReason, setShowReason] = useState(false);
  const callName = useApp().name;

  if (m.role === "notice")
    return (
      <div className="pill">
        <IdolAvatar size={18} />
        <span>{m.text}</span>
      </div>
    );

  if (m.role === "user")
    return (
      <div className="flex flex-col items-end gap-2">
        {!!m.images?.length && <ImageGrid urls={m.images} small />}
        {m.text && (
          <div className="grad max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-sm">
            {m.mode === "image" && <span className="mr-1.5 rounded bg-white/20 px-1.5 py-px text-[11px]">生图</span>}
            {m.text}
          </div>
        )}
      </div>
    );

  const meta = [m.channel, fmtMs(m.latencyMs), m.usage ? `${m.usage.input} → ${m.usage.output} tokens` : ""].filter(Boolean).join(" · ");

  return (
    <div className="group flex gap-3">
      <ModelAvatar model={m.model} size={30} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-xs text-muted">
          <span className="font-semibold text-ink/80">{m.model}</span>
          {meta && <span className="truncate">{meta}</span>}
        </div>

        {!!m.reasoning && (
          <div className="mb-2">
            <button className="chip" onClick={() => setShowReason((v) => !v)}>
              <Brain size={12} /> {m.pending && !m.text ? "思考中…" : "思考过程"}
              <ChevronDown size={12} className={showReason ? "rotate-180" : ""} />
            </button>
            {showReason && <div className="mt-2 whitespace-pre-wrap border-l-2 border-rule pl-3 text-[13px] leading-relaxed text-muted">{m.reasoning}</div>}
          </div>
        )}

        {m.mode === "image" ? (
          m.pending ? (
            <RinneInline mood="imaging" testId="imaging-scene">
              <div className="w-full space-y-2">
                <div className="pill !mx-0">{C.chat.imageStart.replace("{model}", m.model || "")}</div>
                <div className="grid max-w-[420px] grid-cols-2 gap-2">
                  {Array.from({ length: m.imageMeta?.n || 1 }).map((_, i) => (
                    <div key={i} className="shimmer aspect-square rounded-xl" />
                  ))}
                </div>
              </div>
            </RinneInline>
          ) : m.images?.length ? (
            <>
              {/* 结果图直接放在消息里占满宽度（以前塞在全身舞台左边的窄栏里，图被挤小） */}
              <ImageGrid urls={m.images} onEdit={onEditImage} onRegen={onRegenImage} />
              {m.text && <p className="mt-2 text-[13px] leading-relaxed text-muted">{m.text}</p>}
            </>
          ) : (
            !m.error && (
              // 上游返回成功但没有图（或图没存下来）：以前这里什么都不显示，看起来像「没回显」
              <div className="rounded-2xl border border-rule bg-card p-3 text-[13px] text-muted" data-testid="image-empty">
                {C.chat.imageEmpty}
                {isLast && onRegenImage && (
                  <div className="mt-2">
                    <button className="btn-ghost btn-sm" onClick={onRegenImage}>
                      <RefreshCw size={13} /> 重新生成
                    </button>
                  </div>
                )}
              </div>
            )
          )
        ) : (
          <>
            {m.text ? (
              <div className={m.pending && streaming ? "typing-caret-wrap" : ""}>
                <Markdown text={m.text} streaming={m.pending && streaming} />
              </div>
            ) : (
              m.pending ? (
                <RinneInline mood="thinking" testId="thinking-scene">
                  <div className="w-full max-w-xs" role="status">
                    <div className="mb-1.5 text-[13px] text-muted">{m.reasoning ? "正在推理，请稍候…" : "正在整理回答…"}</div>
                    <div className="rn-progress" aria-hidden>
                      <span />
                    </div>
                  </div>
                </RinneInline>
              ) : (
                !m.error && (
                  // 流结束了但一个字都没收到（只有推理、或上游格式没解析出来）：明确告诉用户，而不是留一片空白
                  <div className="text-[13px] italic text-muted" data-testid="chat-empty">
                    {C.chat.textEmpty}
                  </div>
                )
              )
            )}
          </>
        )}

        {m.error &&
          (() => {
            const card = (
              <div className="w-full rounded-2xl border border-bad/30 bg-bad/5 p-3" data-testid="error-card">
                <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-bad">
                  <TriangleAlert size={15} /> {m.error.title}
                </div>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink/80">{m.error.message}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.error.fix === "channels" && (
                    <Link href="/channels" className="btn-ghost btn-sm">
                      {C.errors.fix}
                    </Link>
                  )}
                  {isLast && (onRegenerate || onRegenImage) && (
                    <button className="btn-ghost btn-sm" onClick={m.mode === "image" ? onRegenImage : onRegenerate}>
                      <RefreshCw size={13} /> 重试
                    </button>
                  )}
                </div>
              </div>
            );
            // 只有最后一条报错配棱音（拿着手机），历史里的报错只留卡片
            return (
              <div className="mt-2">
                {isLast ? (
                  <RinneInline mood="error" testId="error-scene">
                    {card}
                  </RinneInline>
                ) : (
                  card
                )}
              </div>
            );
          })()}
        {m.error && firstErrorTip && (
          <div className="mt-2">
            <Coach onOk={() => onFirstErrorSeen?.()}>
              {/* 以前直接显示模板，界面上会露出「{name}」；没有「去修复」按钮时也不该让人去点它 */}
              {m.error.fix === "channels" ? fill(C.errors.firstErrorTip, { name: callName }) : C.errors.firstErrorTipRetry}
            </Coach>
          </div>
        )}

        {!m.pending && (
          <div className="mt-1.5 flex gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
            {m.text && (
              <button className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink" title="复制" onClick={() => copyText(m.text)}>
                <Copy size={14} />
              </button>
            )}
            {isLast && onRegenerate && m.mode !== "image" && (
              <button className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink" title="重新生成" onClick={onRegenerate}>
                <RefreshCw size={14} />
              </button>
            )}
            {m.mode === "image" && onRegenImage && m.error && (
              <button className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink" title="重试" onClick={onRegenImage}>
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function notifyCopied() {
  toast("已复制", "ok");
}

