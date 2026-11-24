"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CloudDownload, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "@/components/ui";
import { dropLibCache } from "@/lib/client/promptlib";

interface Status {
  local: { source: "bundled" | "synced"; ver: string; date?: string; count: number; syncedAt?: string };
  bundled: { ver: string; date?: string; count: number };
  remote?: { ver: string; date: string; note: string };
  update?: boolean;
  error?: string;
}

const fmt = (t?: string) => {
  if (!t) return "—";
  const d = new Date(t);
  return isNaN(d.getTime()) ? t : d.toLocaleString();
};

/** 数据更新（haru 的 sync.php）：查看本地 / 上游版本，一键从 GitHub 同步最新的水仙库 */
export default function SyncPanel({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [st, setSt] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");
  const [elapsed, setElapsed] = useState(0);

  async function check() {
    setChecking(true);
    try {
      setSt(await api<Status>("/api/prompt-lib/sync"));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    void check();
  }, []);
  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);

  async function sync() {
    setRunning(true);
    setMsg("正在从 GitHub 下载最新数据（约 13MB），然后重新生成分块…");
    try {
      const r = await fetch("/api/prompt-lib/sync", { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; msg?: string; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error || `同步失败（HTTP ${r.status}），本地数据未改动`);
      setMsg(j.msg || "同步完成");
      toast(j.msg || "同步完成", "ok");
      dropLibCache();
      router.refresh();
      onDone();
      await check();
    } catch (e) {
      const m = (e as Error).message;
      setMsg("没有同步成功：" + m + "。现有数据没有改动，可以稍后再试；服务器连 GitHub 慢时可以设置环境变量 PROMPT_LIB_GITHUB_PROXY。");
      toast("同步失败", "err");
    } finally {
      setRunning(false);
    }
  }

  async function revert() {
    if (!confirm("放弃同步来的数据，恢复成程序自带的版本？")) return;
    try {
      await api("/api/prompt-lib/sync", { method: "DELETE" });
      dropLibCache();
      router.refresh();
      onDone();
      toast("已恢复内置数据", "ok");
      await check();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs leading-relaxed text-muted">
        灵感库数据来自「水仙的AI提示词」的 GitHub 仓库。有新版本时点「同步」，服务器会下载最新数据并重新生成分块；新数据全部生成好才会替换旧数据，同步过程中提示词页照常能用，失败不影响现有数据。
      </p>
      <div className="card divide-y divide-rule">
        <Row k="本地版本">
          {st ? (
            <>
              {st.local.ver} · {st.local.count} 条 <span className="text-muted">（{st.local.source === "synced" ? "已同步" : "程序自带"}）</span>
            </>
          ) : (
            <span className="shimmer inline-block h-3 w-32 rounded" />
          )}
        </Row>
        <Row k="上次同步">{st ? fmt(st.local.syncedAt) : "…"}</Row>
        <Row k="上游最新">
          {checking ? (
            <Loader2 size={14} className="animate-spin text-muted" />
          ) : st?.error ? (
            <span className="text-bad">检查失败：{st.error}</span>
          ) : st?.remote ? (
            <>
              {st.remote.ver}
              {st.remote.date ? ` · ${fmt(st.remote.date)}` : ""}
              {st.update ? <span className="ml-2 rounded bg-acc/15 px-1.5 py-0.5 text-[11px] text-acc-ink">有更新</span> : <span className="ml-2 inline-flex items-center gap-0.5 text-[11px] text-ok"><Check size={12} />已是最新</span>}
              {st.remote.note && <div className="mt-0.5 text-xs text-muted">上游说明：{st.remote.note}</div>}
            </>
          ) : (
            "—"
          )}
        </Row>
      </div>
      {msg && <p className={`rounded-xl px-3 py-2 text-xs leading-relaxed ${running ? "bg-soft" : "bg-soft"}`}>{msg}{running && ` 已用 ${elapsed} 秒`}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={running} onClick={sync} data-testid="lib-sync">
          {running ? <Loader2 size={15} className="animate-spin" /> : <CloudDownload size={15} />} {running ? "同步中，请稍候…" : "同步"}
        </button>
        <button className="btn-ghost" disabled={running || checking} onClick={check}>
          <RefreshCw size={15} /> 检查更新
        </button>
        {st?.local.source === "synced" && (
          <button className="btn-ghost ml-auto" disabled={running} onClick={revert}>
            <RotateCcw size={15} /> 恢复内置数据
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 px-3 py-2.5">
      <span className="w-20 shrink-0 text-xs text-muted">{k}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
