"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useApp } from "./AppContext";
import { Modal, Toggle, copyText, toast } from "./ui";
import { api } from "@/lib/client/api";
import { copy, fill } from "@/lib/copy";
import type { PublicToken } from "@/lib/types";

type Tok = PublicToken & { used: { tokens: number; cost: number } };

const fmtNum = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K" : String(n));
const fmtDate = (ts: number) => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const mask = (k: string) => (k ? `${k.slice(0, 9)}••••${k.slice(-4)}` : "");

function statusOf(t: Tok) {
  if (!t.enabled) return { text: "已停用", cls: "bg-rule text-muted" };
  if (t.expiresAt && t.expiresAt < Date.now()) return { text: "已过期", cls: "bg-bad/10 text-bad" };
  if (t.quota) {
    const used = t.quota.kind === "tokens" ? t.used.tokens : t.used.cost;
    if (used >= t.quota.limit) return { text: "额度用完", cls: "bg-warn/15 text-warn" };
  }
  return { text: "可用", cls: "bg-ok/10 text-ok" };
}

interface Form {
  name: string;
  enabled: boolean;
  models: string;
  quotaKind: "" | "tokens" | "cost";
  quotaLimit: string;
  expires: string;
}
const emptyForm: Form = { name: "", enabled: true, models: "", quotaKind: "", quotaLimit: "", expires: "" };

function toForm(t: Tok): Form {
  return {
    name: t.name,
    enabled: t.enabled,
    models: (t.models || []).join("\n"),
    quotaKind: t.quota?.kind || "",
    quotaLimit: t.quota ? String(t.quota.limit) : "",
    expires: t.expiresAt ? fmtDate(t.expiresAt) : "",
  };
}
function toBody(f: Form) {
  const models = f.models
    .split(/[\n,，]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    name: f.name.trim(),
    enabled: f.enabled,
    models,
    quota: f.quotaKind && Number(f.quotaLimit) > 0 ? { kind: f.quotaKind, limit: Number(f.quotaLimit) } : null,
    // 当天 23:59:59 过期
    expiresAt: f.expires ? new Date(f.expires + "T23:59:59").getTime() : null,
  };
}

export default function TokenManager({ onDefaultChange }: { onDefaultChange?: (key: string) => void }) {
  const { catalog } = useApp();
  const [list, setList] = useState<Tok[] | null>(null);
  const [currency, setCurrency] = useState("$");
  const [edit, setEdit] = useState<{ id?: string; form: Form } | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  async function load() {
    try {
      const r = await api<{ tokens: Tok[] }>("/api/tokens");
      setList(r.tokens);
    } catch (e) {
      toast((e as Error).message, "err");
      setList([]);
    }
  }
  useEffect(() => {
    void load();
    api<{ pricing: { currency: string } }>("/api/pricing")
      .then((r) => setCurrency(r.pricing.currency || "$"))
      .catch(() => {});
  }, []);

  const modelIds = useMemo(() => [...new Set(catalog.filter((g) => !g.disabled).flatMap((g) => g.models.map((m) => m.id)))].sort(), [catalog]);

  const put = (t: Tok) => setList((l) => (l ? l.map((x) => (x.id === t.id ? t : x)) : l));
  const run = async (id: string, fn: () => Promise<void>) => {
    if (busy[id]) return;
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  async function toggle(t: Tok, on: boolean) {
    // 乐观更新：先改界面，失败再改回去
    put({ ...t, enabled: on });
    try {
      const r = await api<{ token: Tok }>(`/api/tokens/${t.id}`, { method: "PATCH", body: { enabled: on } });
      put(r.token);
    } catch (e) {
      put(t);
      toast((e as Error).message, "err");
    }
  }

  async function save() {
    if (!edit || saving) return;
    const body = toBody(edit.form);
    if (!body.name) return toast("给令牌起个名字吧", "err");
    if (edit.form.quotaKind && !(Number(edit.form.quotaLimit) > 0)) return toast("额度上限要填一个大于 0 的数", "err");
    setSaving(true);
    try {
      if (edit.id) {
        const r = await api<{ token: Tok }>(`/api/tokens/${edit.id}`, { method: "PATCH", body });
        put(r.token);
        toast("令牌已保存", "ok");
      } else {
        const r = await api<{ token: Tok }>("/api/tokens", { body });
        setList((l) => [...(l || []), r.token]);
        copyText(r.token.key, "新令牌已创建，Key 已复制");
      }
      setEdit(null);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  }

  async function del(t: Tok) {
    if (!confirm(fill(copy.tokens.deleteConfirm, { name: t.name }))) return;
    const before = list;
    setList((l) => (l ? l.filter((x) => x.id !== t.id) : l));
    try {
      await api(`/api/tokens/${t.id}`, { method: "DELETE" });
      toast("令牌已删除", "ok");
    } catch (e) {
      setList(before);
      toast((e as Error).message, "err");
    }
  }

  const rekey = (t: Tok) =>
    run(t.id, async () => {
      if (!confirm(copy.tokens.resetConfirm)) return;
      const r = await api<{ token: Tok }>(`/api/tokens/${t.id}`, { method: "PATCH", body: { resetKey: true } });
      put(r.token);
      if (t.id === "default") onDefaultChange?.(r.token.key);
      copyText(r.token.key, "已换新 Key 并复制，旧 Key 立刻失效");
    });
  const resetUsage = (t: Tok) =>
    run(t.id, async () => {
      if (!confirm(fill(copy.tokens.resetUsageConfirm, { name: t.name }))) return;
      const r = await api<{ token: Tok }>(`/api/tokens/${t.id}`, { method: "PATCH", body: { resetUsage: true } });
      put(r.token);
      toast("已用额度已清零", "ok");
    });

  const f = edit?.form;
  const setF = (p: Partial<Form>) => setEdit((e) => (e ? { ...e, form: { ...e.form, ...p } } : e));

  return (
    <div data-testid="token-manager">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">全部令牌</h2>
        <button className="btn-primary btn-sm" onClick={() => setEdit({ form: { ...emptyForm, name: `令牌 ${(list?.length || 0) + 1}` } })}>
          <Plus size={14} /> 新建令牌
        </button>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted">{copy.tokens.multiSay}</p>
      {!list ? (
        <div className="card space-y-3 p-4">
          {[0, 1].map((i) => (
            <div key={i} className="shimmer h-14 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-rule">
          {list.map((t) => {
            const st = statusOf(t);
            const q = t.quota;
            const used = q ? (q.kind === "tokens" ? t.used.tokens : t.used.cost) : 0;
            const pct = q ? Math.min(100, (used / q.limit) * 100) : 0;
            return (
              <div key={t.id} className="px-4 py-3" data-testid="token-row">
                <div className="flex flex-wrap items-center gap-2">
                  <KeyRound size={15} className="shrink-0 text-muted" />
                  <span className="font-medium">{t.name}</span>
                  {t.id === "default" && <span className="rounded-md bg-soft px-1.5 py-px text-[11px] text-muted">默认</span>}
                  <span className={`rounded-md px-1.5 py-px text-[11px] font-medium ${st.cls}`}>{st.text}</span>
                  <span className="ml-auto">
                    <Toggle on={t.enabled} onChange={(v) => void toggle(t, v)} />
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <button className="inline-flex items-center gap-1 font-mono hover:text-ink" onClick={() => copyText(t.key)} title="复制 Key">
                    {mask(t.key)} <Copy size={11} />
                  </button>
                  <span>模型：{t.models?.length ? t.models.join("、") : "不限"}</span>
                  <span>过期：{t.expiresAt ? fmtDate(t.expiresAt) : "永不"}</span>
                  <span>
                    已用：{fmtNum(t.used.tokens)} tokens · 约 {currency}
                    {t.used.cost.toFixed(t.used.cost < 1 ? 4 : 2)}
                  </span>
                </div>
                {q && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-soft">
                      <div className={`h-full rounded-full ${pct >= 100 ? "bg-bad" : pct > 80 ? "bg-warn" : "grad"}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="shrink-0 text-[11px] text-muted">
                      {q.kind === "tokens" ? `${fmtNum(used)} / ${fmtNum(q.limit)} tokens` : `${currency}${used.toFixed(2)} / ${currency}${q.limit}`}
                    </span>
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button className="chip" onClick={() => setEdit({ id: t.id, form: toForm(t) })}>
                    <Pencil size={12} /> 编辑限制
                  </button>
                  <button className="chip" disabled={busy[t.id]} onClick={() => void rekey(t)}>
                    {busy[t.id] ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} 换新 Key
                  </button>
                  {q && (
                    <button className="chip" disabled={busy[t.id]} onClick={() => void resetUsage(t)}>
                      <RotateCcw size={12} /> 额度清零
                    </button>
                  )}
                  {t.id !== "default" && (
                    <button className="chip hover:!text-bad" onClick={() => void del(t)}>
                      <Trash2 size={12} /> 删除
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!edit} onClose={() => !saving && setEdit(null)} title={edit?.id ? "编辑令牌" : "新建令牌"}>
        {f && (
          <div className="space-y-4">
            <div>
              <div className="label">名字</div>
              <input className="input" value={f.name} maxLength={40} onChange={(e) => setF({ name: e.target.value })} placeholder="比如：沉浸式翻译" />
            </div>
            <div>
              <div className="label">能用的模型（一行一个，留空 = 不限；末尾加 * 匹配一系列，如 gpt-4o*）</div>
              <textarea className="input min-h-20 font-mono text-sm" value={f.models} onChange={(e) => setF({ models: e.target.value })} placeholder="不限" />
              {modelIds.length > 0 && (
                <div className="mt-1.5 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                  {modelIds.slice(0, 40).map((m) => {
                    const on = f.models.split(/[\n,，]+/).map((s) => s.trim()).includes(m);
                    return (
                      <button
                        key={m}
                        className={`chip !py-0.5 text-[11px] ${on ? "!border-acc !text-acc-ink" : ""}`}
                        onClick={() => {
                          const cur = f.models.split(/[\n,，]+/).map((s) => s.trim()).filter(Boolean);
                          setF({ models: (on ? cur.filter((x) => x !== m) : [...cur, m]).join("\n") });
                        }}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div>
              <div className="label">额度上限</div>
              <div className="flex gap-2">
                <select className="input w-40" value={f.quotaKind} onChange={(e) => setF({ quotaKind: e.target.value as Form["quotaKind"] })}>
                  <option value="">不限</option>
                  <option value="tokens">按 token 总量</option>
                  <option value="cost">按估算金额</option>
                </select>
                {f.quotaKind && (
                  <input
                    className="input flex-1"
                    type="number"
                    min={0}
                    step={f.quotaKind === "cost" ? 0.01 : 1000}
                    value={f.quotaLimit}
                    onChange={(e) => setF({ quotaLimit: e.target.value })}
                    placeholder={f.quotaKind === "tokens" ? "比如 1000000" : `比如 5（${currency}）`}
                  />
                )}
              </div>
              {f.quotaKind === "cost" && <p className="mt-1 text-[11px] text-muted">{copy.tokens.costHint}</p>}
            </div>
            <div>
              <div className="label">过期日期（留空 = 永不过期，当天 23:59 失效）</div>
              <input className="input" type="date" value={f.expires} onChange={(e) => setF({ expires: e.target.value })} />
            </div>
            <label className="flex items-center justify-between">
              <span className="text-sm">启用</span>
              <Toggle on={f.enabled} onChange={(v) => setF({ enabled: v })} />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost" onClick={() => setEdit(null)} disabled={saving}>
                取消
              </button>
              <button className="btn-primary" onClick={() => void save()} disabled={saving}>
                {saving && <Loader2 size={14} className="animate-spin" />} {edit?.id ? "保存" : "创建"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
