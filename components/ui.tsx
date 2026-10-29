"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import type { Cap, ChannelType } from "@/lib/types";
import { brandOf } from "@/lib/models";
import { IdolAvatar } from "./Logo";
import { useApp } from "./AppContext";

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${on ? "grad" : "bg-rule"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export function CapTags({ caps }: { caps: Cap[] }) {
  return (
    <span className="inline-flex gap-1">
      {caps.includes("chat") && <span className="tag-chat">对话</span>}
      {caps.includes("vision") && <span className="tag-vision">识图</span>}
      {caps.includes("image") && <span className="tag-image">生图</span>}
    </span>
  );
}

export function ModelAvatar({ model, type, size = 28 }: { model?: string; type?: ChannelType; size?: number }) {
  const b = brandOf(model, type);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg font-bold text-white"
      style={{ width: size, height: size, background: b.color, fontSize: size * 0.45 }}
    >
      {b.letter}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        className={`card max-h-[92vh] w-full overflow-hidden rounded-b-none shadow-2xl sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"} flex flex-col`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-rule px-5 py-3.5">
          <div className="font-semibold">{title}</div>
          <button className="rounded-lg p-1 text-muted hover:bg-hover" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="scroll-thin overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

/** 棱音说话的小气泡 */
export function IdolSay({ children, className = "", size = 36 }: { children: React.ReactNode; className?: string; size?: number }) {
  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <IdolAvatar size={size} />
      <div className="rounded-2xl rounded-tl-md border border-rule bg-soft px-3.5 py-2.5 text-sm leading-relaxed text-ink">{children}</div>
    </div>
  );
}

/** 空白页：棱音 + 一句话 */
export function Empty({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <IdolAvatar size={88} />
      <p className="max-w-sm text-sm leading-relaxed text-muted">{text}</p>
      {children}
    </div>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  const { setSidebarOpen } = useApp();
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-rule bg-ground/85 px-4 py-3 backdrop-blur md:px-8">
      <button className="rounded-lg p-1.5 text-muted hover:bg-hover md:hidden" onClick={() => setSidebarOpen(true)} aria-label="打开菜单">
        <Menu size={20} />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-bold">{title}</h1>
        {sub && <p className="truncate text-xs text-muted">{sub}</p>}
      </div>
      {right}
    </header>
  );
}

// ===== 轻量 toast =====
type ToastItem = { id: number; text: string; kind: "ok" | "err" | "info" };
const listeners = new Set<(t: ToastItem) => void>();
let seq = 0;
export function toast(text: string, kind: ToastItem["kind"] = "info") {
  const t = { id: ++seq, text, kind };
  listeners.forEach((l) => l(t));
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const on = (t: ToastItem) => {
      setItems((x) => [...x, t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), 3200);
    };
    listeners.add(on);
    return () => {
      listeners.delete(on);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-2 rounded-full border border-rule bg-card px-4 py-2 text-sm shadow-lg ${
            t.kind === "err" ? "text-bad" : t.kind === "ok" ? "text-ok" : "text-ink"
          }`}
        >
          <IdolAvatar size={20} />
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function copyText(text: string, okMsg = "已复制") {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast(okMsg, "ok"))
    .catch(() => toast("复制失败，请手动选中复制", "err"));
}
