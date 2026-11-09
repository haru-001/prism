"use client";

import { useEffect, useState } from "react";
import { RinneScene } from "@/components/rinne/RinneScene";
import { fill } from "@/lib/copy";
import { dbCopy } from "@/lib/copy-db";
import type { DbDownKind } from "@/lib/dbdown";

/**
 * 「数据库睡着了」提示：整页显示（服务端发现数据库连不上时），或者盖在页面上（使用中接口返回 503 时）。
 * 「重试」请求 /api/db/status，那里会真的去连一次数据库；连上了就刷新页面。
 */
export function DbSleeping({ kind = "down", overlay = false, onClose }: { kind?: DbDownKind; overlay?: boolean; onClose?: () => void }) {
  const t = dbCopy.dbDown;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [cur, setCur] = useState<DbDownKind>(kind);
  useEffect(() => setCur(kind), [kind]);

  async function retry() {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/db/status", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        if (overlay && onClose) onClose();
        window.location.reload();
        return;
      }
      if (j.kind === "busy" || j.kind === "config" || j.kind === "down") setCur(j.kind);
      setMsg(fill(t.stillDown, { time: new Date().toLocaleTimeString() }));
    } catch {
      setMsg(fill(t.stillDown, { time: new Date().toLocaleTimeString() }));
    } finally {
      setBusy(false);
    }
  }

  const title = cur === "busy" ? t.busyTitle : cur === "config" ? t.configTitle : t.title;
  const say = cur === "busy" ? t.busySay : cur === "config" ? t.configSay : t.say;

  const card = (
    <div data-testid="db-sleeping" role="alert" className="w-full max-w-lg rounded-2xl border border-rule bg-card p-6 shadow-xl">
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">
            {title}
          </h1>
          <p className="mt-1 text-sm text-muted">{say}</p>
        </div>
      </div>
      {cur === "down" && (
        <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm">
          {t.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-xs text-muted">{t.apiNote}</p>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" onClick={retry} disabled={busy} data-testid="db-retry">
          {busy ? t.retrying : t.retry}
        </button>
        {cur !== "busy" && (
          <a className="btn-ghost" href="https://console.aiven.io/" target="_blank" rel="noreferrer">
            {t.console}
          </a>
        )}
      </div>
      {msg && (
        <p className="mt-3 text-sm text-muted" data-testid="db-retry-msg">
          {msg}
        </p>
      )}
    </div>
  );

  // 棱音站在右边：休眠是端着东西静候，连接数满是思考，配置不对是报错；四步清单那一侧接到她手边
  const scene = (
    <div className="w-full max-w-4xl">
      <RinneScene mood={cur === "busy" ? "thinking" : cur === "config" ? "error" : "waiting"} size="md" ly={60} steady mobfull testId="db-sleeping-scene" clip="idle-blink" replay={5000} link={card} />
    </div>
  );
  if (overlay)
    return <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm">{scene}</div>;
  return <div className="flex min-h-dvh items-center justify-center p-4">{scene}</div>;
}
