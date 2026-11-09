"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { api } from "@/lib/client/api";
import { copy } from "@/lib/copy";
import { Brand } from "./Logo";
import { RinneScene } from "./rinne/RinneScene";
import { RinneBubble } from "./rinne/RinneBubble";
import { useRinne } from "./rinne/RinneProvider";
import { rinneLine } from "@/lib/rinne-lines";

export function LoginForm() {
  const [pw, setPw] = useState("");
  const { outfit } = useRinne();
  // 台词随服装、按日期轮换；挂载后再算，避免服务端和浏览器时区不同导致水合不一致
  const [say, setSay] = useState(copy.login.say);
  useEffect(() => setSay(rinneLine(outfit, "login")), [outfit]);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    setErr("");
    try {
      await api("/api/auth/login", { body: { password: pw } });
      // 整页跳转，让服务端重新判断要不要先走引导
      window.location.href = "/";
    } catch (e) {
      setErr((e as Error).message || copy.login.wrong);
      setBusy(false);
    }
  }

  const mood = err ? "error" : busy ? "thinking" : "welcome";
  return (
    <div className="flex min-h-dvh items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-3xl">
        <RinneScene
          mood={mood}
          size="lg"
          ly={30}
          priority
          steady
          mobfull
          testId="login-scene"
          clip="login-wave"
          link={
            <div className="flex w-full max-w-sm flex-col gap-3">
              <RinneBubble tone={err ? "bad" : "normal"}>{err || say}</RinneBubble>
          <form onSubmit={submit} className="card w-full max-w-sm p-6 shadow-xl">
            <Brand small />
            <h1 className="mt-3 text-xl font-bold">{copy.login.title}</h1>
            <label className="label mt-5" htmlFor="pw">
              访问密码
            </label>
            <div className="relative">
              <input
                id="pw"
                className="input pr-10"
                type={show ? "text" : "password"}
                autoFocus
                autoComplete="current-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="••••••••"
              />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-ink" onClick={() => setShow((v) => !v)} aria-label={show ? "隐藏密码" : "显示密码"}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button className="btn-primary mt-5 w-full" disabled={!pw || busy}>
              <LogIn size={16} /> {busy ? "登录中…" : "登录"}
            </button>
          </form>
            </div>
          }
        />
      </div>
    </div>
  );
}
