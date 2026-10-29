"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Laptop, Loader2, LogOut, Moon, RotateCcw, Sun } from "lucide-react";
import { useApp, type Theme } from "@/components/AppContext";
import { IdolSay, PageHeader, Toggle, toast } from "@/components/ui";
import { api } from "@/lib/client/api";
import { PERSONA_SYSTEM_PROMPT, callName, copy, fill } from "@/lib/copy";
import type { Settings } from "@/lib/types";

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="font-semibold">{title}</h2>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { settings, updateSettings, theme, setTheme, flags, name } = useApp();
  const [custom, setCustom] = useState(settings.customName);
  const [system, setSystem] = useState(settings.defaultSystem);
  const [temp, setTemp] = useState(settings.temperature);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    setCustom(settings.customName);
    setSystem(settings.defaultSystem);
    setTemp(settings.temperature);
  }, [settings.customName, settings.defaultSystem, settings.temperature]);

  async function save(p: Partial<Settings>, msg = "已保存") {
    try {
      await updateSettings(p);
      toast(msg, "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  async function replay() {
    setBusy("replay");
    try {
      await api("/api/onboarding", { method: "PUT", body: { reset: true } });
      router.push("/onboarding");
    } catch (e) {
      toast((e as Error).message, "err");
      setBusy(null);
    }
  }

  async function changePw() {
    if (pw.trim().length < 6) return toast("密码至少 6 位", "err");
    setBusy("pw");
    try {
      await api("/api/auth/setup", { body: { password: pw } });
      setPw("");
      toast("访问密码已更新", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  const modes: { v: Settings["callMode"]; t: string }[] = [
    { v: "you", t: "你" },
    { v: "producer", t: "制作人" },
    { v: "custom", t: "自定义" },
  ];
  const themes: { v: Theme; t: string; icon: React.ReactNode }[] = [
    { v: "system", t: "跟随系统", icon: <Laptop size={14} /> },
    { v: "light", t: "浅色", icon: <Sun size={14} /> },
    { v: "dark", t: "深色", icon: <Moon size={14} /> },
  ];

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader title="设置" />
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6 md:px-8">
        <IdolSay>{fill(copy.persona.hello, { name })}</IdolSay>

        <Section title="棱音怎么称呼你" sub="界面台词和「让模型也用棱音的口吻」都会用这个称呼">
          <div className="flex flex-wrap gap-2">
            {modes.map((m) => (
              <button
                key={m.v}
                className={`chip px-3 py-1.5 text-sm ${settings.callMode === m.v ? "chip-on" : ""}`}
                onClick={() => save({ callMode: m.v }, "称呼已更新")}
              >
                {m.t}
              </button>
            ))}
          </div>
          {settings.callMode === "custom" && (
            <div className="mt-3 flex gap-2">
              <input className="input" maxLength={20} placeholder="想被怎么叫？最多 20 个字" value={custom} onChange={(e) => setCustom(e.target.value)} />
              <button className="btn-primary shrink-0" onClick={() => save({ customName: custom.trim() }, "称呼已更新")} disabled={custom.trim() === settings.customName}>
                保存
              </button>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">
            预览：“{fill(copy.persona.tagline, { name: callName(settings.callMode, custom.trim() || settings.customName) })}”
          </p>
        </Section>

        <Section title="让模型也用棱音的口吻" sub="打开后，聊天页的回答会以棱音的身份说话。只影响聊天页，不影响对外接口。">
          <div className="flex items-center gap-3">
            <Toggle on={settings.personaInModel} onChange={(v) => save({ personaInModel: v }, v ? "好耶，接下来由我来回答！" : "已关闭")} />
            <span className="text-sm">{settings.personaInModel ? "已开启" : "已关闭"}</span>
            <button className="ml-auto text-xs text-muted hover:text-ink" onClick={() => setShowPrompt((v) => !v)}>
              {showPrompt ? "收起人设提示词" : "查看人设提示词"}
            </button>
          </div>
          {showPrompt && (
            <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-soft p-3 font-mono text-xs leading-relaxed text-muted">{fill(PERSONA_SYSTEM_PROMPT, { name })}</pre>
          )}
        </Section>

        <Section title="默认系统提示词与温度" sub="只用在聊天页的新对话">
          <textarea
            className="input min-h-24 resize-y"
            placeholder="例如：回答尽量简洁，用中文。"
            value={system}
            onChange={(e) => setSystem(e.target.value)}
          />
          <div className="mt-3 flex items-center gap-3">
            <span className="shrink-0 text-sm">温度</span>
            <input type="range" min={0} max={2} step={0.1} value={temp} onChange={(e) => setTemp(Number(e.target.value))} className="w-full accent-[var(--acc)]" />
            <span className="w-8 shrink-0 text-right font-mono text-sm">{temp.toFixed(1)}</span>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              className="btn-primary btn-sm"
              onClick={() => save({ defaultSystem: system, temperature: temp })}
              disabled={system === settings.defaultSystem && temp === settings.temperature}
            >
              保存
            </button>
          </div>
        </Section>

        <Section title="主题">
          <div className="flex flex-wrap gap-2">
            {themes.map((t) => (
              <button key={t.v} className={`chip px-3 py-1.5 text-sm ${theme === t.v ? "chip-on" : ""}`} onClick={() => setTheme(t.v)}>
                {t.icon} {t.t}
              </button>
            ))}
          </div>
        </Section>

        <Section title="访问密码">
          {flags.envPassword ? (
            <p className="text-sm text-muted">密码由环境变量 ACCESS_PASSWORD 管理，要改的话请到 Vercel 的环境变量里修改并重新部署。</p>
          ) : (
            <div className="flex gap-2">
              <input className="input" type="password" autoComplete="new-password" placeholder="新密码，至少 6 位" value={pw} onChange={(e) => setPw(e.target.value)} />
              <button className="btn-primary shrink-0" onClick={changePw} disabled={!pw || busy === "pw"}>
                {busy === "pw" && <Loader2 size={14} className="animate-spin" />} 修改
              </button>
            </div>
          )}
        </Section>

        <Section title="存储">
          <ul className="space-y-1.5 text-sm">
            <li>
              <span className="text-muted">数据：</span>
              {flags.storage === "redis" ? "Upstash Redis" : "本地文件 .data/kv.json（仅适合本地开发）"}
            </li>
            <li>
              <span className="text-muted">图片：</span>
              {flags.blob ? "Vercel Blob" : "存在数据库里（建议接上 Vercel Blob，图片多了会占用 Redis 空间）"}
            </li>
          </ul>
        </Section>

        <Section title="其他">
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={replay} disabled={busy === "replay"}>
              {busy === "replay" ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} 重新看引导
            </button>
            <button className="btn-danger" onClick={logout}>
              <LogOut size={14} /> 退出登录
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">重新看引导不会删掉已有的渠道，聊天页的提示也会重新出现。</p>
        </Section>
      </div>
    </div>
  );
}
