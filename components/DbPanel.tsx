"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useApp } from "@/components/AppContext";
import { IdolSay, Modal, toast } from "@/components/ui";
import { fill } from "@/lib/copy";
import { dbCopy } from "@/lib/copy-db";
import { fmtBytes, fmtPct } from "@/lib/client/format";

type Cat = { key: string; name: string; bytes: number; count: number; oldest: number | null };
type Usage = {
  storage: "mysql" | "local";
  usedBytes: number;
  quotaBytes: number;
  at: number;
  ratio: number;
  warnRatio: number;
  freeBytes: number;
  categories: Cat[];
};
type Preview = { type: string; olderThanDays: number; count: number; bytes: number; applied: boolean; freedBytes?: number; usage?: { usedBytes: number; quotaBytes: number; at: number } | null };

const TYPES = [
  { k: "logs", l: "请求日志", unit: "条日志", note: "日志详情会一起删掉。" },
  { k: "usage", l: "用量统计", unit: "行用量记录", note: "用量页里这段时间的趋势和花费会跟着消失。" },
  { k: "images", l: "图片", unit: "张图片", note: "只删存在数据库里的图；对话和图库里用到这些图的地方会显示不出来。存在 Vercel Blob 里的图不受影响。" },
  { k: "conversations", l: "会话", unit: "个会话", note: "按最后一次更新的时间算。" },
] as const;
const AGES = [
  { d: 7, l: "7 天前" },
  { d: 30, l: "30 天前" },
  { d: 90, l: "90 天前" },
  { d: 180, l: "180 天前" },
  { d: 0, l: "全部" },
];

/** 设置页「数据库容量」：打开设置页时查一次（或点刷新），不轮询 */
export function DbPanel() {
  const { patchBoot, refreshConversations } = useApp();
  const [u, setU] = useState<Usage | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<(typeof TYPES)[number]["k"]>("logs");
  const [days, setDays] = useState(30);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "apply">("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await api<Usage>("/api/db/usage");
      setU(r);
      if (r.storage === "mysql") patchBoot((b) => ({ ...b, db: { usedBytes: r.usedBytes, quotaBytes: r.quotaBytes, at: r.at, ratio: r.ratio, warnRatio: r.warnRatio } }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [patchBoot]);

  useEffect(() => {
    void load();
  }, [load]);

  async function doPreview() {
    setBusy("preview");
    try {
      const r = await api<Preview>("/api/db/cleanup", { method: "POST", body: { type, olderThanDays: days } });
      if (!r.count) toast(dbCopy.dbQuota.nothing);
      else setPreview(r);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  }

  async function doApply() {
    if (!preview) return;
    setBusy("apply");
    try {
      const r = await api<Preview>("/api/db/cleanup", { method: "POST", body: { type: preview.type, olderThanDays: preview.olderThanDays, confirm: true } });
      setPreview(null);
      // 删了会话的话，左栏的会话列表也要跟着更新
      if (r.type === "conversations") void refreshConversations().catch(() => {});
      toast(fill(dbCopy.dbQuota.done, { freed: fmtBytes(r.freedBytes ?? r.bytes) }), "ok");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  }

  if (!u)
    return (
      <div className="text-sm text-muted">
        {err ? (
          <span>
            {err}{" "}
            <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void load()}>
              重试
            </button>
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> 正在量……
          </span>
        )}
      </div>
    );
  if (u.storage === "local") return <IdolSay>{dbCopy.dbQuota.local}</IdolSay>;

  const pct = fmtPct(u.ratio);
  const warn = u.ratio >= u.warnRatio;
  const t = TYPES.find((x) => x.k === type)!;
  const max = Math.max(1, ...u.categories.map((c) => c.bytes));

  return (
    <div data-testid="db-panel">
      <IdolSay>
        {fill(dbCopy.dbQuota.say, { quota: fmtBytes(u.quotaBytes), used: fmtBytes(u.usedBytes), pct })}
        {warn && <div className="mt-1 font-medium text-warn">{fill(dbCopy.dbQuota.warnShort, { pct })}</div>}
      </IdolSay>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs text-muted">
          <span data-testid="db-used">
            {fmtBytes(u.usedBytes)} / {fmtBytes(u.quotaBytes)}（{pct}）
          </span>
          <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => void load()} disabled={loading} title="重新量一次">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> 刷新
          </button>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-hover">
          <div className={`h-full rounded-full ${warn ? "bg-warn" : "bg-acc"}`} style={{ width: `${Math.min(100, u.ratio * 100)}%` }} />
        </div>
      </div>

      <ul className="mt-4 space-y-2" data-testid="db-categories">
        {u.categories.map((c) => (
          <li key={c.key} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">
                {c.name}
                {c.key !== "other" && <span className="ml-1.5 text-xs text-muted">{c.count} {c.key === "images" ? "张" : c.key === "conversations" ? "个" : c.key === "usage" ? "行" : "条"}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-muted">{fmtBytes(c.bytes)}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-hover">
              <div className="h-full rounded-full bg-acc/60" style={{ width: `${(c.bytes / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {u.freeBytes > 0 && <p className="mt-2 text-xs text-muted">其中约 {fmtBytes(u.freeBytes)} 是表里的空闲空间，清理时会顺便整理。</p>}
      <p className="mt-1 text-xs text-muted">{dbCopy.dbQuota.note}</p>

      <div className="mt-4 rounded-xl border border-rule p-3">
        <div className="label">清理旧数据</div>
        <div className="flex flex-wrap gap-1.5" data-testid="db-clean-types">
          {TYPES.map((x) => (
            <button key={x.k} className={`chip ${type === x.k ? "chip-on" : ""}`} onClick={() => setType(x.k)}>
              {x.l}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="db-clean-ages">
          {AGES.map((a) => (
            <button key={a.d} className={`chip ${days === a.d ? "chip-on" : ""}`} onClick={() => setDays(a.d)}>
              {a.l}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">{t.note}</p>
        <button className="btn-ghost mt-3" onClick={() => void doPreview()} disabled={!!busy} data-testid="db-clean-preview">
          {busy === "preview" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} 看看会删多少
        </button>
      </div>

      <Modal open={!!preview} onClose={() => setPreview(null)} title="确认清理">
        {preview && (
          <div data-testid="db-clean-confirm">
            <p className="text-sm">
              将删除{preview.olderThanDays ? ` ${preview.olderThanDays} 天前的` : "全部"} <b>{preview.count}</b> {TYPES.find((x) => x.k === preview.type)?.unit}，大约 {fmtBytes(preview.bytes)}。
            </p>
            <p className="mt-2 text-xs text-muted">{TYPES.find((x) => x.k === preview.type)?.note}</p>
            <p className="mt-2 text-sm font-medium text-bad">{dbCopy.dbQuota.confirm}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setPreview(null)} disabled={busy === "apply"}>
                取消
              </button>
              <button className="btn-danger" onClick={() => void doApply()} disabled={busy === "apply"} data-testid="db-clean-apply">
                {busy === "apply" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} 确认清理
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
