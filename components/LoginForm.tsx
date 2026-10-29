"use client";

import { useState } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { api } from "@/lib/client/api";
import { copy } from "@/lib/copy";
import { Brand, IdolAvatar } from "./Logo";

export function LoginForm() {
  const [pw, setPw] = useState("");
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

  return (
    <div className="flex min-h-dvh items-center justify-center p-5">
      <div className="card w-full max-w-sm overflow-hidden shadow-xl">
        <div className="grad relative h-24">
          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2">
            <IdolAvatar size={84} className="ring-4 ring-card" />
          </div>
        </div>
        <form onSubmit={submit} className="px-6 pb-6 pt-12">
          <div className="mb-1 flex justify-center">
            <Brand small />
          </div>
          <h1 className="mt-3 text-center text-xl font-bold">{copy.login.title}</h1>
          <p className="mb-5 mt-1 text-center text-sm text-muted">{copy.login.say}</p>
          <label className="label" htmlFor="pw">
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
          {err && <p className="mt-2 text-sm text-bad">{err}</p>}
          <button className="btn-primary mt-5 w-full" disabled={!pw || busy}>
            <LogIn size={16} /> {busy ? "登录中…" : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
