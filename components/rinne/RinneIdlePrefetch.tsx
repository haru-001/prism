"use client";

import { useEffect } from "react";
import { MOODS, type Mood, type StageSize } from "@/lib/rinne";
import { idlePrefetch } from "@/lib/client/rinne-load";
import { useRinne } from "./RinneProvider";

/**
 * 首屏只加载当前页面要用的那张立绘（一般是欢迎），其余状态等浏览器空闲时再预取，
 * 之后切到思考、报错、生图时不用等下载。开了省流量模式就不预取（idlePrefetch 里判断）。
 * 登录后的页面外层有 cookie 的形象设置、里层有服务端设置，两层都挂了这个组件：
 * 只让最里层（level 最大的）那个真正预取，免得 cookie 里的旧服装也被预取一遍。
 */
const mounted = new Map<number, number>();
const topLevel = () => Math.max(-1, ...[...mounted.entries()].filter(([, n]) => n > 0).map(([l]) => l));

export function RinneIdlePrefetch({ level = 0 }: { level?: number }) {
  const { outfit, show } = useRinne();
  useEffect(() => {
    mounted.set(level, (mounted.get(level) ?? 0) + 1);
    return () => void mounted.set(level, (mounted.get(level) ?? 1) - 1);
  }, [level]);
  useEffect(() => {
    if (!show) return;
    const jobs: [typeof outfit, Mood, StageSize][] = [];
    for (const m of MOODS) jobs.push([outfit, m, "md"]);
    // toast / 提醒条用的小立绘
    jobs.push([outfit, "success", "xs"], [outfit, "error", "xs"], [outfit, "waiting", "bar"]);
    return idlePrefetch(jobs, 2500, () => topLevel() === level);
  }, [outfit, show, level]);
  return null;
}
