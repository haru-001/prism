"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Mood } from "@/lib/rinne";
import { RinneFigure } from "./RinneFigure";
import { useRinne } from "./RinneProvider";
import { IdolAvatar } from "../Logo";

interface Today {
  requests: number;
  tokens: number;
  fails: number;
}

function fmt(n: number) {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? (n / 1e3).toFixed(1) + "k" : String(n);
}

/**
 * 侧边栏底部的小立绘卡片：棱音半身 + 今日用量 + 线路状态。
 * 用量每 5 分钟取一次 /api/usage?days=1（失败就只显示线路状态）。
 * 状态：没有可用线路 → 等待；今天有失败 → 出错；今天有请求 → 成功；其余 → 欢迎。
 * 「显示棱音」关掉时退回原来的一行小头像。
 */
export function RinneSideCard({ status, dot, onClick }: { status: string; dot: string; onClick?: () => void }) {
  const { show } = useRinne();
  const [today, setToday] = useState<Today | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/usage?days=1", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!alive || !j?.total) return;
          setToday({ requests: j.total.requests, tokens: j.total.inTok + j.total.outTok, fails: j.total.fails });
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const noLine = dot === "bg-muted";
  const mood: Mood = noLine ? "waiting" : today?.fails ? "error" : today?.requests ? "success" : "welcome";

  if (!show)
    return (
      <Link href="/channels" onClick={onClick} className="flex items-center gap-2.5 border-t border-rule px-4 py-3 text-xs text-muted hover:text-ink">
        <IdolAvatar size={24} />
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="truncate">{status}</span>
      </Link>
    );

  return (
    <Link href="/usage" onClick={onClick} className="rn-side-card hover:brightness-[1.03]" data-testid="rinne-side-card" data-mood={mood}>
      <div className="rn-side-info">
        <div className="font-semibold text-ink/90">今日用量</div>
        {today ? (
          <div className="text-muted" data-testid="side-usage">
            {today.requests} 次 · {fmt(today.tokens)} tokens
            {today.fails > 0 && <span className="text-bad"> · 失败 {today.fails}</span>}
          </div>
        ) : (
          <div className="text-muted">—</div>
        )}
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
          <span className="truncate">{status}</span>
        </div>
      </div>
      <RinneFigure mood={mood} size="bar" standalone className="rn-bar-fig rn-side-fig" />
    </Link>
  );
}
