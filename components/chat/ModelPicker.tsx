"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { ModelGroup } from "@/lib/types";
import { channelTypeInfo } from "@/lib/models";
import { CapTags, ModelAvatar } from "../ui";

export interface Picked {
  model: string;
  channelId?: string;
}

export function ModelPicker({
  catalog,
  value,
  onChange,
  badge,
}: {
  catalog: ModelGroup[];
  value?: Picked;
  onChange: (p: Picked, isImage: boolean) => void;
  badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, [open]);

  const groups = useMemo(() => {
    const k = q.trim().toLowerCase();
    return [...catalog]
      .sort((a, b) => Number(a.disabled) - Number(b.disabled))
      .map((g) => ({ ...g, models: g.models.filter((m) => !k || m.id.toLowerCase().includes(k) || g.channelName.toLowerCase().includes(k)) }))
      .filter((g) => g.models.length);
  }, [catalog, q]);

  const group = catalog.find((g) => g.channelId === value?.channelId) || catalog.find((g) => g.models.some((m) => m.id === value?.model));

  return (
    <div className="relative" ref={ref}>
      <button
        className="flex max-w-[70vw] items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-hover sm:max-w-md"
        onClick={() => setOpen((v) => !v)}
      >
        {badge}
        <ModelAvatar model={value?.model} type={group?.type} size={24} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{value?.model || "选择模型"}</span>
          {group && <span className="block truncate text-[11px] leading-3 text-muted">{group.channelName}</span>}
        </span>
        <ChevronDown size={16} className="shrink-0 text-muted" />
      </button>
      {open && (
        <div className="card absolute left-0 top-full z-40 mt-1 w-[min(92vw,380px)] overflow-hidden shadow-2xl">
          <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
            <Search size={14} className="text-muted" />
            <input autoFocus className="w-full bg-transparent text-sm outline-none placeholder:text-muted" placeholder="搜索模型或渠道" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="scroll-thin max-h-[60vh] overflow-y-auto p-1.5">
            {groups.map((g) => (
              <div key={g.channelId} className="mb-1">
                <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-semibold text-muted">
                  <span>{g.channelName}</span>
                  <span className="font-normal opacity-70">{channelTypeInfo(g.type).label}</span>
                  {g.disabled && <span className="ml-auto rounded bg-warn/15 px-1.5 text-warn">{g.reason || "已停用"}</span>}
                </div>
                {g.models.map((m) => {
                  const on = value?.model === m.id && (!value.channelId || value.channelId === g.channelId);
                  return (
                    <button
                      key={g.channelId + m.id}
                      disabled={g.disabled}
                      onClick={() => {
                        onChange({ model: m.id, channelId: g.channelId }, m.caps.includes("image"));
                        setOpen(false);
                        setQ("");
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-45 ${
                        on ? "bg-soft" : "hover:bg-hover"
                      }`}
                    >
                      <ModelAvatar model={m.id} type={g.type} size={22} />
                      <span className="min-w-0 flex-1 truncate">{m.id}</span>
                      <CapTags caps={m.caps} />
                      {on && <Check size={14} className="text-acc" />}
                    </button>
                  );
                })}
              </div>
            ))}
            {!groups.length && <p className="px-3 py-6 text-center text-xs text-muted">{catalog.length ? "没有匹配的模型" : "还没有启用的模型，去渠道页添加吧"}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
