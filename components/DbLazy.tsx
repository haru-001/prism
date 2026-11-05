"use client";

import { lazy, Suspense, useEffect, useState, type ComponentProps } from "react";
import type { DbDownKind } from "@/lib/dbdown";

/**
 * 「数据库睡着了」提示按需加载：平时页面不用为它多下载代码，真的要显示时才取。
 * 用 React 自带的 lazy，不额外引入 next/dynamic 的运行时。
 */
const LazyDbSleeping = lazy(() => import("./DbSleeping").then((m) => ({ default: m.DbSleeping })));

export function DbSleeping(props: ComponentProps<typeof LazyDbSleeping>) {
  return (
    <Suspense fallback={null}>
      <LazyDbSleeping {...props} />
    </Suspense>
  );
}

/** 挂在根布局里：任何站内接口返回「数据库睡着了」时，弹出提示盖在页面上 */
export function DbDownWatcher() {
  const [kind, setKind] = useState<DbDownKind | null>(null);
  useEffect(() => {
    const on = (e: Event) => setKind(((e as CustomEvent).detail?.kind as DbDownKind) || "down");
    window.addEventListener("prism:db-down", on);
    return () => window.removeEventListener("prism:db-down", on);
  }, []);
  if (!kind) return null;
  return <DbSleeping kind={kind} overlay onClose={() => setKind(null)} />;
}
