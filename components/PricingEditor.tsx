"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "./ui";
import type { PriceRule, Pricing } from "@/lib/types";

type Row = { pattern: string; input: string; output: string; perRequest: string };
const toRow = (r: PriceRule): Row => ({ pattern: r.pattern, input: String(r.input ?? ""), output: String(r.output ?? ""), perRequest: r.perRequest ? String(r.perRequest) : "" });

/** 模型单价表：每百万 token 的价格，按模型名匹配（末尾 * 通配），越靠前越优先 */
export default function PricingEditor({ onSaved }: { onSaved?: () => void }) {
  const [currency, setCurrency] = useState("$");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api<{ pricing: Pricing }>("/api/pricing")
      .then((r) => {
        setCurrency(r.pricing.currency || "$");
        setRows(r.pricing.rules.map(toRow));
      })
      .catch((e) => {
        toast((e as Error).message, "err");
        setRows([]);
      });
  }, []);

  const set = (i: number, p: Partial<Row>) => {
    setDirty(true);
    setRows((l) => (l ? l.map((r, j) => (j === i ? { ...r, ...p } : r)) : l));
  };

  async function save() {
    if (!rows || saving) return;
    setSaving(true);
    try {
      const rules = rows
        .filter((r) => r.pattern.trim())
        .map((r) => ({ pattern: r.pattern.trim(), input: Number(r.input) || 0, output: Number(r.output) || 0, perRequest: Number(r.perRequest) || undefined }));
      const r = await api<{ pricing: Pricing }>("/api/pricing", { method: "PUT", body: { pricing: { currency: currency.trim() || "$", rules } } });
      setRows(r.pricing.rules.map(toRow));
      setCurrency(r.pricing.currency);
      setDirty(false);
      toast("单价已保存，花费按新单价重算", "ok");
      onSaved?.();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid="pricing-editor">
      <h2 className="mb-1 font-semibold">模型单价</h2>
      <p className="mb-2 text-xs leading-relaxed text-muted">
        每百万 token 的价格，模型名末尾加 * 匹配一系列（如 gpt-4o*），从上往下匹配第一条。生图模型可以填「每次」固定价。改单价后，历史花费和按金额的令牌额度都按新单价重算。
      </p>
      <div className="card p-3">
        {!rows ? (
          <div className="shimmer h-20 rounded-xl" />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted">货币符号</span>
              <input
                className="input !w-16 !py-1 text-center"
                value={currency}
                maxLength={4}
                onChange={(e) => {
                  setCurrency(e.target.value);
                  setDirty(true);
                }}
              />
            </div>
            <div className="hidden grid-cols-[1fr_88px_88px_88px_28px] gap-2 px-1 text-[11px] text-muted sm:grid">
              <span>模型名</span>
              <span>输入 / 1M</span>
              <span>输出 / 1M</span>
              <span>每次</span>
              <span />
            </div>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_28px] gap-2 sm:grid-cols-[1fr_88px_88px_88px_28px]" data-testid="price-row">
                <input className="input !py-1.5 font-mono text-sm" value={r.pattern} placeholder="gpt-4o*" onChange={(e) => set(i, { pattern: e.target.value })} />
                <button className="rounded-lg text-muted hover:bg-hover hover:text-bad sm:order-last" onClick={() => (setDirty(true), setRows((l) => l!.filter((_, j) => j !== i)))} aria-label="删除这条单价">
                  <X size={14} className="mx-auto" />
                </button>
                <div className="col-span-2 grid grid-cols-3 gap-2 sm:col-span-1 sm:contents">
                  <input className="input !py-1.5 text-sm" type="number" min={0} step="0.01" placeholder="输入" value={r.input} onChange={(e) => set(i, { input: e.target.value })} />
                  <input className="input !py-1.5 text-sm" type="number" min={0} step="0.01" placeholder="输出" value={r.output} onChange={(e) => set(i, { output: e.target.value })} />
                  <input className="input !py-1.5 text-sm" type="number" min={0} step="0.001" placeholder="每次" value={r.perRequest} onChange={(e) => set(i, { perRequest: e.target.value })} />
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1">
              <button className="chip" onClick={() => (setDirty(true), setRows((l) => [...(l || []), { pattern: "", input: "", output: "", perRequest: "" }]))}>
                <Plus size={12} /> 加一条
              </button>
              <button className="btn-primary btn-sm" disabled={!dirty || saving} onClick={() => void save()}>
                {saving && <Loader2 size={13} className="animate-spin" />} 保存单价
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
