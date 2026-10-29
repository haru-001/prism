"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CloudDownload, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { copy, fill } from "@/lib/copy";
import { CHANNEL_TYPES, channelTypeInfo, guessCaps, normalizeBaseUrl } from "@/lib/models";
import type { Cap, ChannelType, PublicChannel } from "@/lib/types";
import { IdolAvatar } from "../Logo";
import { Modal, toast } from "../ui";
import { ProviderCards, ProviderLogo } from "../ProviderCards";

const CAP_LABEL: Record<Cap, string> = { chat: "对话", vision: "识图", image: "生图" };
const CAP_CLASS: Record<Cap, string> = { chat: "tag-chat", vision: "tag-vision", image: "tag-image" };

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1.5 flex items-start gap-2 text-xs leading-relaxed text-muted">
      <IdolAvatar size={18} />
      <span className="pt-px">{children}</span>
    </div>
  );
}

interface AliasRow {
  alias: string;
  upstream: string;
}

export function ChannelEditor({
  open,
  channel,
  autoFetch,
  onClose,
}: {
  open: boolean;
  channel: PublicChannel | null; // null = 新建
  autoFetch?: boolean;
  onClose: (changed: boolean) => void;
}) {
  const [id, setId] = useState<string | null>(null);
  const [type, setType] = useState<ChannelType>("openai");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [keyHint, setKeyHint] = useState("");
  const [priority, setPriority] = useState(1);
  const [timeoutSec, setTimeoutSec] = useState(60);
  const [apiVersion, setApiVersion] = useState("2024-10-21");
  const [allModels, setAllModels] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [caps, setCaps] = useState<Record<string, Cap[]>>({});
  const [popular, setPopular] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [manual, setManual] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const changed = useRef(false);
  const modelsRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<string[]>([]);
  selectedRef.current = models;

  // 打开时载入渠道
  useEffect(() => {
    if (!open) return;
    changed.current = false;
    setErr("");
    setFetchMsg(null);
    setQ("");
    setManual("");
    setKey("");
    setPopular([]);
    if (channel) {
      setId(channel.id);
      setType(channel.type);
      setName(channel.name);
      setBaseUrl(channel.baseUrl);
      setKeyHint(channel.keyHint);
      setPriority(channel.priority);
      setTimeoutSec(Math.round((channel.timeoutMs || 60000) / 1000));
      setApiVersion(channel.apiVersion || "2024-10-21");
      setAllModels([...new Set([...channel.allModels, ...channel.models])]);
      setModels(channel.models);
      setAliases(Object.entries(channel.mapping || {}).map(([alias, upstream]) => ({ alias, upstream })));
      setCaps(channel.caps || {});
    } else {
      setId(null);
      setType("openai");
      setName("");
      setBaseUrl(CHANNEL_TYPES[0].base);
      setKeyHint("");
      setPriority(1);
      setTimeoutSec(60);
      setApiVersion("2024-10-21");
      setAllModels([]);
      setModels([]);
      setAliases([]);
      setCaps({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channel?.id]);

  useEffect(() => {
    if (open && autoFetch && channel) {
      void fetchModels(channel.id);
      setTimeout(() => modelsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoFetch, channel?.id]);

  function pickType(t: ChannelType) {
    setType(t);
    if (!baseUrl || CHANNEL_TYPES.some((x) => x.base && x.base === baseUrl)) setBaseUrl(channelTypeInfo(t).base);
  }

  function mappingObj() {
    const m: Record<string, string> = {};
    for (const r of aliases) if (r.alias.trim() && r.upstream.trim()) m[r.alias.trim()] = r.upstream.trim();
    return m;
  }

  function basics() {
    const b: Record<string, unknown> = {
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      priority: Number(priority) || 0,
      timeoutMs: Math.max(5, Number(timeoutSec) || 60) * 1000,
    };
    if (type === "azure") b.apiVersion = apiVersion.trim();
    if (key.trim()) b.key = key.trim();
    return b;
  }

  /** 把基本信息先存下（新建时创建渠道），返回渠道 id */
  async function ensureSaved(): Promise<string> {
    if (!baseUrl.trim()) throw new Error("请填写 Base URL");
    if (id) {
      await api(`/api/channels/${id}`, { method: "PATCH", body: basics() });
      if (key.trim()) {
        setKeyHint("已更新");
        setKey("");
      }
      return id;
    }
    if (!key.trim()) throw new Error("请填写 API Key");
    const r = await api<{ channel: PublicChannel }>("/api/channels", { body: { ...basics(), type } });
    setId(r.channel.id);
    setName(r.channel.name);
    setKeyHint(r.channel.keyHint);
    setKey("");
    changed.current = true;
    return r.channel.id;
  }

  async function fetchModels(knownId?: string) {
    setErr("");
    setFetchMsg(null);
    setFetching(true);
    try {
      const cid = knownId || (await ensureSaved());
      const r = await api<{ models: string[]; popular: string[]; latencyMs: number }>(`/api/channels/${cid}/models`, { method: "POST" });
      changed.current = true;
      setAllModels([...new Set([...r.models, ...selectedRef.current])]);
      setPopular(r.popular);
      setModels((cur) => (cur.length ? cur : r.popular));
      setFetchMsg({
        ok: true,
        text: r.models.length ? `${fill(copy.channels.fetched, { count: r.models.length })} 连接正常 · ${r.latencyMs}ms` : copy.onboarding.step3Empty,
      });
    } catch (e) {
      setFetchMsg({ ok: false, text: `模型列表没取到：${(e as Error).message}` });
    } finally {
      setFetching(false);
    }
  }

  async function save() {
    setErr("");
    const bad = aliases.find((r) => (r.alias.trim() && !r.upstream.trim()) || (!r.alias.trim() && r.upstream.trim()));
    if (bad) return setErr("别名和上游模型要成对填写");
    setSaving(true);
    try {
      // 只保留仍在使用的模型的手动能力标签
      const map = mappingObj();
      const used = new Set([...models, ...Object.keys(map), ...Object.values(map)]);
      const capsOut = Object.fromEntries(Object.entries(caps).filter(([m]) => used.has(m)));
      const body = { ...basics(), models, allModels, mapping: map, caps: capsOut };
      if (id) await api(`/api/channels/${id}`, { method: "PATCH", body });
      else {
        if (!key.trim()) throw new Error("请填写 API Key");
        await api("/api/channels", { body: { ...body, type } });
      }
      changed.current = true;
      toast(id ? "渠道已保存" : "渠道已添加", "ok");
      onClose(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function addManual() {
    const names = manual
      .split(/[\s,，]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!names.length) return;
    setAllModels((m) => [...new Set([...m, ...names])]);
    setModels((m) => [...new Set([...m, ...names])]);
    setManual("");
  }

  function capsOf(m: string): Cap[] {
    return caps[m] || guessCaps(m);
  }

  function toggleCap(m: string, c: Cap) {
    const cur = capsOf(m);
    const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
    setCaps((all) => ({ ...all, [m]: next.length ? next : ["chat"] }));
  }

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const list = [...new Set([...models, ...allModels])];
    // 已选的排前面
    list.sort((a, b) => Number(models.includes(b)) - Number(models.includes(a)) || a.localeCompare(b));
    return kw ? list.filter((m) => m.toLowerCase().includes(kw)) : list;
  }, [models, allModels, q]);
  const SHOW = 300;

  const endpoint = normalizeBaseUrl(type, baseUrl);
  const isNew = !channel;

  return (
    <Modal open={open} onClose={() => onClose(changed.current)} title={isNew ? "添加渠道" : `编辑渠道 · ${channel?.name}`} wide>
      <div className="space-y-4">
        {isNew && !id ? (
          <div>
            <div className="label">供应商</div>
            <ProviderCards value={type} onChange={pickType} />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <ProviderLogo type={type} size={26} />
            <span className="font-semibold">{channelTypeInfo(type).label}</span>
            <span className="text-xs text-muted">类型创建后不能改，需要的话新建一条</span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">名称</label>
            <input className="input" placeholder={`留空自动命名，如「${channelTypeInfo(type).label} 1」`} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">优先级</label>
              <input className="input" type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">超时（秒）</label>
              <input className="input" type="number" min={5} value={timeoutSec} onChange={(e) => setTimeoutSec(Number(e.target.value))} />
            </div>
          </div>
        </div>
        <p className="-mt-2 text-xs text-muted">数字越小越优先。同一个模型挂在多条线路上时先走优先级高的，失败自动换下一条；超时指等待上游开始响应的时间。</p>

        <div>
          <label className="label">Base URL</label>
          <input className="input font-mono" placeholder="https://your-relay.example.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <Tip>
            {copy.onboarding.tipV1}
            {endpoint && (
              <>
                {" "}实际请求：<span className="font-mono text-ink">{endpoint}</span>。想原样使用地址可以在结尾加 #。
              </>
            )}
            {type === "azure" && <> {copy.onboarding.tipAzure}</>}
          </Tip>
        </div>

        <div className={type === "azure" ? "grid gap-4 sm:grid-cols-2" : ""}>
          <div>
            <label className="label">API Key</label>
            <input
              className="input font-mono"
              type="password"
              autoComplete="off"
              placeholder={id ? `${keyHint}（留空则不修改）` : "sk-…"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <Tip>{copy.onboarding.tipKey}</Tip>
          </div>
          {type === "azure" && (
            <div>
              <label className="label">API 版本</label>
              <input className="input font-mono" value={apiVersion} onChange={(e) => setApiVersion(e.target.value)} />
            </div>
          )}
        </div>

        {/* 模型 */}
        <div ref={modelsRef} className="rounded-2xl border border-rule p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="font-semibold">模型</div>
            <span className="text-xs text-muted">
              已启用 {models.length} / {allModels.length}
            </span>
            <button className="btn-primary btn-sm ml-auto" onClick={() => fetchModels()} disabled={fetching}>
              {fetching ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={14} />} 获取模型
            </button>
          </div>
          {fetchMsg && (
            <div className={`mb-3 flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${fetchMsg.ok ? "bg-soft text-ink" : "bg-bad/10 text-bad"}`}>
              <IdolAvatar size={18} />
              <span className="pt-px">{fetchMsg.text}</span>
            </div>
          )}
          {allModels.length > 0 && (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <label className="flex min-w-[160px] flex-1 items-center gap-2 rounded-xl border border-rule bg-card px-3 py-1.5">
                  <Search size={14} className="text-muted" />
                  <input className="w-full bg-transparent text-sm outline-none placeholder:text-muted" placeholder="搜索模型…" value={q} onChange={(e) => setQ(e.target.value)} />
                </label>
                <button className="chip" onClick={() => setModels((m) => [...new Set([...m, ...filtered])])}>
                  全选{q ? "结果" : ""}
                </button>
                <button className="chip" onClick={() => setModels((m) => (q ? m.filter((x) => !filtered.includes(x)) : []))}>
                  清空{q ? "结果" : ""}
                </button>
                {popular.length > 0 && (
                  <button className="chip" onClick={() => setModels(popular)}>
                    只选常用
                  </button>
                )}
              </div>
              <div className="scroll-thin max-h-72 overflow-y-auto rounded-xl border border-rule">
                {filtered.slice(0, SHOW).map((m) => {
                  const on = models.includes(m);
                  const mc = capsOf(m);
                  return (
                    <div key={m} className="flex items-center gap-2 border-b border-rule px-3 py-1.5 last:border-b-0">
                      <button
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "grad border-transparent text-white" : "border-rule"}`}
                        onClick={() => setModels((cur) => (on ? cur.filter((x) => x !== m) : [...cur, m]))}
                        aria-label={on ? `取消 ${m}` : `启用 ${m}`}
                      >
                        {on && <Check size={11} />}
                      </button>
                      <button className="min-w-0 flex-1 truncate text-left font-mono text-xs" onClick={() => setModels((cur) => (on ? cur.filter((x) => x !== m) : [...cur, m]))}>
                        {m}
                      </button>
                      {on && (
                        <span className="flex shrink-0 gap-1" title="点击切换能力标签">
                          {(["chat", "vision", "image"] as Cap[]).map((c) => (
                            <button key={c} className={`${CAP_CLASS[c]} ${mc.includes(c) ? "" : "opacity-30 grayscale"}`} onClick={() => toggleCap(m, c)}>
                              {CAP_LABEL[c]}
                            </button>
                          ))}
                        </span>
                      )}
                    </div>
                  );
                })}
                {!filtered.length && <p className="px-3 py-4 text-center text-xs text-muted">没有匹配的模型</p>}
                {filtered.length > SHOW && <p className="px-3 py-2 text-center text-xs text-muted">还有 {filtered.length - SHOW} 个，搜索一下缩小范围</p>}
              </div>
              <p className="mt-1.5 text-xs text-muted">勾选后才会出现在聊天和 /v1/models 里。能力标签按模型名自动识别，点一下可以手动切换。</p>
            </>
          )}
          <div className="mt-3 flex gap-2">
            <input
              className="input font-mono"
              placeholder="手动添加模型名，多个用空格隔开"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addManual();
                }
              }}
            />
            <button className="btn-ghost shrink-0" onClick={addManual}>
              <Plus size={14} /> 添加
            </button>
          </div>
        </div>

        {/* 别名 */}
        <div className="rounded-2xl border border-rule p-4">
          <div className="mb-1 flex items-center gap-2">
            <div className="font-semibold">模型别名</div>
            <button className="chip ml-auto" onClick={() => setAliases((a) => [...a, { alias: "", upstream: models[0] || "" }])}>
              <Plus size={12} /> 添加别名
            </button>
          </div>
          <p className="mb-3 text-xs text-muted">别名会作为模型名出现在聊天和对外接口里，请求时换成右边的上游模型名。例如把中转站的 gpt-4o-2024-08-06 叫成 gpt-4o，就能和官方线路互为备用。</p>
          <datalist id="prism-upstream-models">
            {allModels.slice(0, 500).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <div className="space-y-2">
            {aliases.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="input font-mono"
                  placeholder="对外名称（别名）"
                  value={r.alias}
                  onChange={(e) => setAliases((a) => a.map((x, j) => (j === i ? { ...x, alias: e.target.value } : x)))}
                />
                <span className="shrink-0 text-muted">→</span>
                <input
                  className="input font-mono"
                  placeholder="上游模型名"
                  list="prism-upstream-models"
                  value={r.upstream}
                  onChange={(e) => setAliases((a) => a.map((x, j) => (j === i ? { ...x, upstream: e.target.value } : x)))}
                />
                <button className="shrink-0 rounded-lg p-1.5 text-muted hover:text-bad" onClick={() => setAliases((a) => a.filter((_, j) => j !== i))} aria-label="删除别名">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!aliases.length && <p className="text-xs text-muted">还没有别名。</p>}
          </div>
        </div>

        {err && <p className="text-sm text-bad">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={() => onClose(changed.current)}>
            取消
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving && <Loader2 size={14} className="animate-spin" />} 保存
          </button>
        </div>
      </div>
    </Modal>
  );
}
