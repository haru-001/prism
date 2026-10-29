"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Check, Eye, EyeOff, Loader2, Plus, Search } from "lucide-react";
import { api } from "@/lib/client/api";
import { copy, fill } from "@/lib/copy";
import { normalizeBaseUrl } from "@/lib/models";
import type { ChannelType, PublicChannel } from "@/lib/types";
import { Brand, IdolAvatar } from "./Logo";
import { ProviderCards } from "./ProviderCards";
import { CHANNEL_TYPES } from "@/lib/models";

type PwMode = "env" | "set" | "none";

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-muted">
      <IdolAvatar size={20} />
      <span className="pt-0.5">{children}</span>
    </div>
  );
}

function Say({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 flex items-start gap-3">
      <IdolAvatar size={44} />
      <div className="rounded-2xl rounded-tl-md border border-rule bg-soft px-3.5 py-2.5 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

export function Onboarding({ passwordMode, channelCount, name }: { passwordMode: PwMode; channelCount: number; name: string }) {
  const [step, setStep] = useState(1);
  const [pwMode, setPwMode] = useState<PwMode>(passwordMode);
  const [existing, setExisting] = useState(channelCount);

  // 第 1 步
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);

  // 第 2 步
  const [type, setType] = useState<ChannelType>("openai");
  const [baseUrl, setBaseUrl] = useState(CHANNEL_TYPES[0].base);
  const [key, setKey] = useState("");
  const [apiVersion, setApiVersion] = useState("2024-10-21");
  const [channelId, setChannelId] = useState<string | null>(null);

  // 第 3 步
  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [latency, setLatency] = useState<number | null>(null);
  const [fetchErr, setFetchErr] = useState("");
  const [q, setQ] = useState("");
  const [manual, setManual] = useState("");
  const [showAll, setShowAll] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function pickType(t: ChannelType) {
    setType(t);
    const info = CHANNEL_TYPES.find((x) => x.type === t)!;
    // 只在用户没改过地址时自动换成官方地址
    if (!baseUrl || CHANNEL_TYPES.some((x) => x.base && x.base === baseUrl)) setBaseUrl(info.base);
    setErr("");
  }

  async function savePassword() {
    setErr("");
    if (pw.trim().length < 6) return setErr("密码至少 6 位");
    setBusy(true);
    try {
      await api("/api/auth/setup", { body: { password: pw } });
      setPwMode("set");
      setStep(2);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setErr("");
    if (!baseUrl.trim()) return setErr("请填写 Base URL");
    if (!key.trim() && !channelId) return setErr("请填写 API Key");
    setBusy(true);
    try {
      let id = channelId;
      const body: Record<string, unknown> = { type, baseUrl: baseUrl.trim(), apiVersion: type === "azure" ? apiVersion : undefined };
      if (key.trim()) body.key = key.trim();
      if (id) await api(`/api/channels/${id}`, { method: "PATCH", body });
      else {
        const r = await api<{ channel: PublicChannel }>("/api/channels", { body });
        id = r.channel.id;
        setChannelId(id);
      }
      setFetchErr("");
      try {
        const m = await api<{ models: string[]; popular: string[]; latencyMs: number }>(`/api/channels/${id}/models`, { method: "POST" });
        setModels(m.models);
        setSelected(m.popular);
        setLatency(m.latencyMs);
      } catch (e) {
        setModels([]);
        setSelected([]);
        setLatency(null);
        setFetchErr((e as Error).message);
      }
      setShowAll(false);
      setQ("");
      setStep(3);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveModels() {
    if (!channelId) return;
    await api(`/api/channels/${channelId}`, { method: "PATCH", body: { models: selected, allModels: [...new Set([...models, ...selected])] } });
  }

  async function finish(save: boolean) {
    setBusy(true);
    setErr("");
    try {
      if (save) await saveModels();
      await api("/api/onboarding", { method: "PUT", body: { completed: true } });
      window.location.href = "/";
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  async function addAnother() {
    setBusy(true);
    setErr("");
    try {
      await saveModels();
      setExisting((n) => n + 1);
      setChannelId(null);
      setKey("");
      setModels([]);
      setSelected([]);
      setType("openai");
      setBaseUrl(CHANNEL_TYPES[0].base);
      setStep(2);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addManual() {
    const names = manual
      .split(/[\s,，]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!names.length) return;
    setModels((m) => [...new Set([...m, ...names])]);
    setSelected((s) => [...new Set([...s, ...names])]);
    setManual("");
  }

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const list = [...new Set([...selected, ...models])].filter((m) => !kw || m.toLowerCase().includes(kw));
    return list;
  }, [models, selected, q]);
  const LIMIT = 24;
  const visible = showAll || q ? shown : shown.slice(0, LIMIT);

  const endpoint = normalizeBaseUrl(type, baseUrl);

  return (
    <div className="flex min-h-dvh justify-center px-4 py-8 sm:items-center">
      <div className="card w-full max-w-xl p-6 shadow-xl sm:p-8">
        <div className="mb-5 flex items-center justify-between">
          <Brand small />
          <span className="text-xs text-muted">第 {step} 步 / 共 4 步</span>
        </div>
        <div className="mb-6 grid grid-cols-4 gap-1.5">
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={`h-1.5 rounded-full ${i <= step ? "grad" : "bg-rule"}`} />
          ))}
        </div>

        {step === 1 && (
          <div>
            <div className="flex flex-col items-center text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/img/welcome.jpg" alt="棱音" className="h-40 w-40 rounded-[28px] object-cover shadow-lg ring-4 ring-white/60 dark:ring-white/5" />
              <h1 className="mt-4 text-2xl font-bold">{copy.onboarding.step1Title}</h1>
            </div>
            <Say>
              {pwMode === "env"
                ? copy.onboarding.step1EnvSay
                : pwMode === "set"
                  ? copy.onboarding.step1DoneSay
                  : fill(copy.onboarding.step1Say, { name })}
            </Say>
            {pwMode === "none" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void savePassword();
                }}
              >
                <label className="label" htmlFor="pw">
                  访问密码
                </label>
                <div className="relative">
                  <input
                    id="pw"
                    className="input pr-10"
                    type={showPw ? "text" : "password"}
                    autoFocus
                    autoComplete="new-password"
                    placeholder="至少 6 位"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                  />
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-ink" onClick={() => setShowPw((v) => !v)} aria-label="显示或隐藏密码">
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <Tip>密码加密保存在服务端。想用环境变量管理的话，也可以在 Vercel 里设 ACCESS_PASSWORD。</Tip>
                {err && <p className="mt-3 text-sm text-bad">{err}</p>}
                <div className="mt-6 flex flex-wrap gap-2">
                  <button className="btn-primary" disabled={busy}>
                    {busy && <Loader2 size={16} className="animate-spin" />} 下一步
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-6 flex flex-wrap gap-2">
                <button className="btn-primary" onClick={() => setStep(2)}>
                  {pwMode === "env" ? "已在环境变量里设好，跳过" : "下一步"}
                </button>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <h1 className="text-xl font-bold">{copy.onboarding.step2Title}</h1>
            <Say>
              {copy.onboarding.step2Say}
              {existing > 0 && <> {name}已经接好 {existing} 条线路啦，也可以直接去聊天。</>}
            </Say>
            <ProviderCards value={type} onChange={pickType} />
            <div className="mt-4">
              <label className="label" htmlFor="base">
                Base URL
              </label>
              <input
                id="base"
                className="input font-mono"
                placeholder={type === "compatible" ? "https://your-relay.example.com" : CHANNEL_TYPES.find((x) => x.type === type)?.base}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
              <Tip>
                {copy.onboarding.tipV1}
                {endpoint && endpoint !== baseUrl.trim() && (
                  <>
                    {" "}实际请求：<span className="font-mono text-ink">{endpoint}</span>
                  </>
                )}
                {type === "azure" && <> {copy.onboarding.tipAzure}</>}
              </Tip>
            </div>
            <div className="mt-4">
              <label className="label" htmlFor="key">
                API Key
              </label>
              <input
                id="key"
                className="input font-mono"
                type="password"
                autoComplete="off"
                placeholder={channelId ? "留空则沿用刚才填的 Key" : "sk-…"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <Tip>{copy.onboarding.tipKey}</Tip>
            </div>
            {type === "azure" && (
              <div className="mt-4">
                <label className="label" htmlFor="ver">
                  API 版本
                </label>
                <input id="ver" className="input font-mono" value={apiVersion} onChange={(e) => setApiVersion(e.target.value)} />
              </div>
            )}
            {err && <p className="mt-3 text-sm text-bad">{err}</p>}
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <button className="btn-primary" onClick={connect} disabled={busy}>
                {busy && <Loader2 size={16} className="animate-spin" />} {busy ? "连接中…" : "连接并获取模型"}
              </button>
              {existing > 0 && (
                <button className="btn-ghost" onClick={() => finish(false)} disabled={busy}>
                  直接去聊天
                </button>
              )}
              <button className="ml-auto text-xs text-muted hover:text-ink" onClick={() => finish(false)} disabled={busy}>
                {copy.onboarding.skip}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h1 className="text-xl font-bold">{copy.onboarding.step3Title}</h1>
            <Say>
              {fetchErr ? (
                fill(copy.onboarding.step3Fail, { msg: fetchErr })
              ) : models.length ? (
                <>
                  取回 {models.length} 个模型，<span className="font-semibold text-ok">连接正常 · {latency}ms</span>。
                  {selected.length ? `常用的我先帮${name}勾好啦！` : "没认出常用模型，挑几个要用的吧。"}
                </>
              ) : (
                copy.onboarding.step3Empty
              )}
            </Say>
            {models.length > 12 && (
              <label className="mb-3 flex items-center gap-2 rounded-xl border border-rule bg-card px-3 py-1.5">
                <Search size={14} className="text-muted" />
                <input className="w-full bg-transparent text-sm outline-none placeholder:text-muted" placeholder="搜索模型…" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
            )}
            <div className="flex flex-wrap gap-1.5">
              {visible.map((m) => {
                const on = selected.includes(m);
                return (
                  <button
                    key={m}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-mono text-xs transition ${
                      on ? "border-acc bg-soft text-acc-ink" : "border-rule bg-card text-muted hover:text-ink"
                    }`}
                    onClick={() => setSelected((s) => (on ? s.filter((x) => x !== m) : [...s, m]))}
                  >
                    {on && <Check size={12} />} {m}
                  </button>
                );
              })}
              {!showAll && !q && shown.length > LIMIT && (
                <button className="chip" onClick={() => setShowAll(true)}>
                  +{shown.length - LIMIT}
                </button>
              )}
            </div>
            <div className="mt-4 flex gap-2">
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
            <p className="mt-3 text-xs text-muted">已选 {selected.length} 个。之后还能在渠道页里改。</p>
            {err && <p className="mt-3 text-sm text-bad">{err}</p>}
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <button className="btn-primary" onClick={() => finish(true)} disabled={busy}>
                {busy && <Loader2 size={16} className="animate-spin" />} {copy.onboarding.finish}
              </button>
              <button className="btn-ghost" onClick={addAnother} disabled={busy}>
                <Plus size={14} /> {copy.onboarding.addMore}
              </button>
              <button className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-ink" onClick={() => setStep(2)} disabled={busy}>
                <ArrowLeft size={12} /> 返回修改地址和 Key
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
