"use client";

import { useState } from "react";
import { CHANNEL_TYPES } from "@/lib/models";
import type { ChannelType } from "@/lib/types";

export function ProviderLogo({ type, size = 32, dim }: { type: ChannelType; size?: number; dim?: boolean }) {
  const info = CHANNEL_TYPES.find((x) => x.type === type) || CHANNEL_TYPES[3];
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg font-bold text-white"
      style={{ width: size, height: size, background: info.color, fontSize: size * 0.45, opacity: dim ? 0.55 : 1 }}
    >
      {info.letter}
    </span>
  );
}

/** 供应商卡片：OpenAI / Claude / Gemini / OpenAI 兼容，Azure 收在「更多」里 */
export function ProviderCards({ value, onChange }: { value: ChannelType; onChange: (t: ChannelType) => void }) {
  const [more, setMore] = useState(value === "azure");
  const list = CHANNEL_TYPES.filter((t) => more || t.type !== "azure");
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {list.map((t) => {
          const on = value === t.type;
          return (
            <button
              key={t.type}
              type="button"
              onClick={() => onChange(t.type)}
              className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition ${
                on ? "border-acc bg-soft ring-2 ring-acc/20" : "border-rule bg-card hover:bg-hover"
              }`}
            >
              <ProviderLogo type={t.type} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{t.label}</span>
                <span className="block truncate text-xs text-muted">{t.sub}</span>
              </span>
            </button>
          );
        })}
      </div>
      {!more && (
        <button type="button" className="mt-2 text-xs text-muted hover:text-ink" onClick={() => setMore(true)}>
          用 Azure OpenAI？展开更多
        </button>
      )}
    </div>
  );
}
