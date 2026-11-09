"use client";

import { lazy, Suspense } from "react";
import { useApp } from "@/components/AppContext";

const DbQuotaNotice = lazy(() => import("./DbQuotaNotice").then((m) => ({ default: m.DbQuotaNotice })));

/** 只有数据库真的快满了才去加载顶部提醒，平时不多下载代码 */
export function DbQuotaGate() {
  const { db } = useApp();
  if (!db || db.ratio < db.warnRatio) return null;
  return (
    <Suspense fallback={null}>
      <DbQuotaNotice />
    </Suspense>
  );
}
