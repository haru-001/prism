"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2, Trash2 } from "lucide-react";
import { PageHeader, toast } from "@/components/ui";
import { api } from "@/lib/client/api";
import { copy } from "@/lib/copy";
import { RinnePageHead } from "@/components/rinne/RinnePageHead";


// 单价表按需加载
const PricingEditor = dynamic(() => import("@/components/PricingEditor"), { ssr: false, loading: () => <div className="shimmer h-32 rounded-2xl" /> });

interface Bucket {
  key: string;
  requests: number;
  fails: number;
  inTok: number;
  outTok: number;
  cost: number;
}
interface Report {
  days: Bucket[];
  models: Bucket[];
  channels: Bucket[];
  tokens: Bucket[];
  total: Bucket;
  currency: string;
  unpriced: string[];
  tz: string;
  tokenNames: Record<string, string>;
}

const RANGES = [7, 30, 90];
const fmtNum = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K" : String(Math.round(n)));
const fmtCost = (c: string, n: number) => `${c}${n.toFixed(n > 0 && n < 1 ? 4 : 2)}`;

function Trend({ days, metric, currency }: { days: Bucket[]; metric: "tokens" | "cost" | "requests"; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const val = (b: Bucket) => (metric === "tokens" ? b.inTok + b.outTok : metric === "cost" ? b.cost : b.requests);
  const max = Math.max(...days.map(val), 0) || 1;
  const W = 100 / days.length;
  const label = (b: Bucket) =>
    metric === "tokens" ? `${fmtNum(b.inTok)} 入 / ${fmtNum(b.outTok)} 出` : metric === "cost" ? fmtCost(currency, b.cost) : `${b.requests} 次（失败 ${b.fails}）`;
  const h = hover != null ? days[hover] : null;
  return (
    <div ref={ref} className="relative" data-testid="usage-trend">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-40 w-full" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="bar" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--acc)" />
            <stop offset="100%" stopColor="var(--acc2, var(--acc))" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        {days.map((b, i) => {
          const v = val(b);
          const bh = v ? Math.max(0.8, (v / max) * 38) : 0.3;
          return (
            <g key={b.key} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <rect x={i * W} y={0} width={W} height={40} fill="transparent" />
              <rect
                x={i * W + W * 0.15}
                y={40 - bh}
                width={W * 0.7}
                height={bh}
                rx={Math.min(0.8, W * 0.2)}
                fill={v ? "url(#bar)" : "var(--rule)"}
                opacity={hover == null || hover === i ? 1 : 0.45}
              />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{days[0]?.key.slice(5)}</span>
        <span>{days[days.length - 1]?.key.slice(5)}</span>
      </div>
      <div className="mt-1 h-5 text-center text-xs text-muted">{h ? `${h.key}：${label(h)}` : "把鼠标移到柱子上看当天数字"}</div>
    </div>
  );
}

function Table({ title, rows, currency, name }: { title: string; rows: Bucket[]; currency: string; name?: (k: string) => string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <div>
      <h2 className="mb-2 font-semibold">{title}</h2>
      <div className="card overflow-x-auto">
        <div className="min-w-[460px] divide-y divide-rule text-sm">
          <div className="grid grid-cols-[1fr_70px_90px_90px_90px] gap-2 px-4 py-2 text-[11px] text-muted">
            <span>名称</span>
            <span className="text-right">请求</span>
            <span className="text-right">输入</span>
            <span className="text-right">输出</span>
            <span className="text-right">估算花费</span>
          </div>
          {shown.map((r) => (
            <div key={r.key} className="grid grid-cols-[1fr_70px_90px_90px_90px] items-center gap-2 px-4 py-2">
              <span className="truncate" title={r.key}>
                {name ? name(r.key) : r.key}
              </span>
              <span className="text-right tabular-nums">
                {r.requests}
                {r.fails > 0 && <span className="text-bad"> / {r.fails}</span>}
              </span>
              <span className="text-right tabular-nums">{fmtNum(r.inTok)}</span>
              <span className="text-right tabular-nums">{fmtNum(r.outTok)}</span>
              <span className="text-right tabular-nums">{fmtCost(currency, r.cost)}</span>
            </div>
          ))}
        </div>
      </div>
      {rows.length > 8 && (
        <button className="mt-1.5 text-xs text-muted hover:text-ink" onClick={() => setAll((v) => !v)}>
          {all ? "收起" : `展开全部 ${rows.length} 项`}
        </button>
      )}
    </div>
  );
}

export default function UsagePage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<"tokens" | "cost" | "requests">("tokens");
  const [clearing, setClearing] = useState(false);
  const cache = useRef(new Map<number, Report>());
  const reqId = useRef(0);

  async function load(d: number, force = false) {
    const id = ++reqId.current;
    const hit = cache.current.get(d);
    if (hit && !force) setData(hit);
    setLoading(true);
    try {
      const r = await api<Report>(`/api/usage?days=${d}`);
      cache.current.set(d, r);
      if (id === reqId.current) setData(r);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load(days);
  }, [days]);

  async function clear() {
    if (clearing || !confirm("清空全部用量统计？令牌的已用额度也会一起归零。")) return;
    setClearing(true);
    try {
      await api("/api/usage", { method: "DELETE" });
      cache.current.clear();
      toast("用量统计已清空", "ok");
      await load(days, true);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setClearing(false);
    }
  }

  const t = data?.total;
  const cur = data?.currency || "$";
  const tokenName = useMemo(() => {
    const names = data?.tokenNames || {};
    return (k: string) => {
      const [id, arch] = k.split("~");
      return (names[id] || id) + (arch ? "（清零前）" : "");
    };
  }, [data]);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader
        title="用量与花费"
        sub={data ? `按天统计 · 时区 ${data.tz}` : "按天统计"}
        right={
          <div className="flex rounded-xl bg-soft p-0.5">
            {RANGES.map((d) => (
              <button
                key={d}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${days === d ? "bg-card text-ink shadow-sm" : "text-muted"}`}
                onClick={() => setDays(d)}
              >
                {d} 天
              </button>
            ))}
          </div>
        }
      />
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 md:px-8">
        <RinnePageHead page="usage">{copy.usage.say}</RinnePageHead>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { l: "请求", v: t ? String(t.requests) : "", s: t ? `失败 ${t.fails}` : "" },
            { l: "输入 tokens", v: t ? fmtNum(t.inTok) : "", s: "" },
            { l: "输出 tokens", v: t ? fmtNum(t.outTok) : "", s: "" },
            { l: "估算花费", v: t ? fmtCost(cur, t.cost) : "", s: data?.unpriced.length ? `${data.unpriced.length} 个模型没填单价` : "" },
          ].map((c) => (
            <div key={c.l} className="card p-4" data-testid="usage-stat">
              <div className="text-xs text-muted">{c.l}</div>
              {c.v ? <div className="mt-1 text-2xl font-bold tabular-nums">{c.v}</div> : <div className="shimmer mt-2 h-7 w-20 rounded-lg" />}
              {c.s && <div className="mt-0.5 text-[11px] text-muted">{c.s}</div>}
            </div>
          ))}
        </div>

        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="font-semibold">每日趋势</h2>
            {loading && <Loader2 size={14} className="animate-spin text-muted" />}
            <div className="ml-auto flex rounded-xl bg-soft p-0.5">
              {(
                [
                  ["tokens", "tokens"],
                  ["cost", "花费"],
                  ["requests", "请求"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${metric === k ? "bg-card text-ink shadow-sm" : "text-muted"}`}
                  onClick={() => setMetric(k)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {data ? <Trend days={data.days} metric={metric} currency={cur} /> : <div className="shimmer h-40 rounded-xl" />}
        </div>

        {data && !data.total.requests && <p className="text-center text-sm text-muted">{copy.usage.empty}</p>}

        {data && data.unpriced.length > 0 && (
          <p className="rounded-xl bg-warn/10 px-3 py-2 text-xs text-ink/80">
            {copy.usage.unpriced}
            {data.unpriced.join("、")}
          </p>
        )}

        {data && data.total.requests > 0 && (
          <div className="space-y-6">
            <Table title="按模型" rows={data.models} currency={cur} />
            <Table title="按渠道" rows={data.channels} currency={cur} name={(k) => (k === "-" ? "（没连上任何线路）" : k)} />
            <Table title="按令牌" rows={data.tokens} currency={cur} name={tokenName} />
          </div>
        )}

        <PricingEditor onSaved={() => (cache.current.clear(), void load(days, true))} />

        <div className="flex justify-end">
          <button className="btn-ghost btn-sm hover:!text-bad" onClick={() => void clear()} disabled={clearing}>
            {clearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} 清空用量统计
          </button>
        </div>
      </div>
    </div>
  );
}
