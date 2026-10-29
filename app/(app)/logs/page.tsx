"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import { Empty, PageHeader, toast } from "@/components/ui";
import { api, fmtMs, fmtTime } from "@/lib/client/api";
import { copy } from "@/lib/copy";
import type { LogEntry } from "@/lib/types";

const SOURCE: Record<LogEntry["source"], string> = {
  ui: "聊天页",
  "ui-image": "聊天页生图",
  openai: "OpenAI 接口",
  claude: "Claude 接口",
  gemini: "Gemini 接口",
  image: "生图接口",
};

type Filter = "all" | "ok" | "err";

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ logs: LogEntry[] }>("/api/logs");
      setLogs(r.logs);
    } catch (e) {
      toast((e as Error).message, "err");
      setLogs((l) => l || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function clear() {
    if (!confirm("清空全部请求日志？")) return;
    try {
      await api("/api/logs", { method: "DELETE" });
      setLogs([]);
      toast("日志已清空", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (logs || []).filter(
      (l) =>
        (filter === "all" || (filter === "ok" ? l.ok : !l.ok)) &&
        (!kw || [l.model, l.upstreamModel, l.channel, l.error].some((s) => s?.toLowerCase().includes(kw))),
    );
  }, [logs, filter, q]);

  const stats = useMemo(() => {
    const all = logs || [];
    const ok = all.filter((l) => l.ok);
    const avg = ok.length ? Math.round(ok.reduce((s, l) => s + l.latencyMs, 0) / ok.length) : 0;
    return { total: all.length, ok: ok.length, err: all.length - ok.length, avg };
  }, [logs]);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader
        title="请求日志"
        sub="最近 500 条，含聊天页和对外接口的请求"
        right={
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={load} disabled={loading}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              <span className="hidden sm:inline">刷新</span>
            </button>
            <button className="btn-ghost" onClick={clear} disabled={!logs?.length}>
              <Trash2 size={16} />
              <span className="hidden sm:inline">清空</span>
            </button>
          </div>
        }
      />
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
        {logs && logs.length > 0 && (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { k: "总请求", v: stats.total },
              { k: "成功", v: stats.ok, c: "text-ok" },
              { k: "失败", v: stats.err, c: stats.err ? "text-bad" : "" },
              { k: "成功平均耗时", v: fmtMs(stats.avg) },
            ].map((s) => (
              <div key={s.k} className="card px-4 py-3">
                <div className="text-xs text-muted">{s.k}</div>
                <div className={`mt-0.5 text-lg font-bold ${s.c || ""}`}>{s.v}</div>
              </div>
            ))}
          </div>
        )}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(
            [
              ["all", "全部"],
              ["ok", "成功"],
              ["err", "失败"],
            ] as [Filter, string][]
          ).map(([f, t]) => (
            <button key={f} className={`chip ${filter === f ? "chip-on" : ""}`} onClick={() => setFilter(f)}>
              {t}
            </button>
          ))}
          <label className="ml-auto flex min-w-[180px] items-center gap-2 rounded-xl border border-rule bg-card px-3 py-1.5">
            <Search size={14} className="text-muted" />
            <input className="w-full bg-transparent text-sm outline-none placeholder:text-muted" placeholder="按模型、渠道、报错搜索" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>

        {logs === null ? (
          <div className="flex justify-center py-16 text-muted">
            <Loader2 className="animate-spin" />
          </div>
        ) : !logs.length ? (
          <Empty text={copy.logs.empty} />
        ) : !list.length ? (
          <p className="py-10 text-center text-sm text-muted">没有符合条件的记录</p>
        ) : (
          <div className="card divide-y divide-rule overflow-hidden">
            <div className="hidden grid-cols-[110px_1fr_120px_90px_90px_80px] gap-3 bg-soft px-4 py-2 text-xs font-medium text-muted md:grid">
              <span>时间</span>
              <span>模型 / 来源</span>
              <span>渠道</span>
              <span>耗时</span>
              <span>Token</span>
              <span>状态</span>
            </div>
            {list.map((l) => {
              const expanded = open === l.id;
              const hasMore = !!l.error || l.attempts > 1 || l.upstreamModel;
              return (
                <div key={l.id}>
                  <button
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm hover:bg-hover md:grid-cols-[110px_1fr_120px_90px_90px_80px]"
                    onClick={() => setOpen(expanded ? null : l.id)}
                  >
                    <span className="order-3 text-xs text-muted md:order-none">{fmtTime(l.at)}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[13px]">{l.model || "（未指定）"}</span>
                      <span className="block text-xs text-muted">
                        {SOURCE[l.source] || l.source}
                        {l.stream && " · 流式"}
                        {l.attempts > 1 && ` · 切换 ${l.attempts - 1} 次`}
                      </span>
                    </span>
                    <span className="order-4 truncate text-xs text-muted md:order-none md:text-sm md:text-ink">{l.channel || "—"}</span>
                    <span className="order-5 text-xs md:order-none md:text-sm">
                      {fmtMs(l.latencyMs)}
                      {l.ttfbMs != null && l.stream && <span className="block text-[11px] text-muted">首字 {fmtMs(l.ttfbMs)}</span>}
                    </span>
                    <span className="order-6 text-xs text-muted md:order-none">
                      {l.inTokens != null || l.outTokens != null ? `${l.inTokens ?? "?"} / ${l.outTokens ?? "?"}` : "—"}
                    </span>
                    <span className="order-2 flex items-center gap-1 md:order-none">
                      <span className={`inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium ${l.ok ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"}`}>
                        {l.ok ? "成功" : l.status ? `失败 ${l.status}` : "失败"}
                      </span>
                      {hasMore && <ChevronDown size={14} className={`text-muted transition ${expanded ? "rotate-180" : ""}`} />}
                    </span>
                  </button>
                  {expanded && hasMore && (
                    <div className="space-y-1 bg-soft/60 px-4 py-3 text-xs">
                      {l.upstreamModel && l.upstreamModel !== l.model && (
                        <div>
                          <span className="text-muted">上游模型：</span>
                          <span className="font-mono">{l.upstreamModel}</span>
                        </div>
                      )}
                      <div>
                        <span className="text-muted">尝试线路数：</span>
                        {l.attempts}
                      </div>
                      {l.error && <pre className="whitespace-pre-wrap break-all font-mono text-bad">{l.error}</pre>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
