"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppContext";
import { RinneFigure } from "@/components/rinne/RinneFigure";
import { fill } from "@/lib/copy";
import { dbCopy } from "@/lib/copy-db";
import { fmtPct } from "@/lib/client/format";

const KEY = "prism.dbQuotaDismissed";

/**
 * 数据库快满时（默认超过 80%）棱音在页面顶部提醒一句。
 * 数字来自启动时顺带读到的容量快照，不单独查库；点「知道了」后 24 小时内不再提醒。
 */
export function DbQuotaNotice() {
  const { db } = useApp();
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const t = Number(localStorage.getItem(KEY) || 0);
    setHidden(Date.now() - t < 24 * 3600_000);
  }, []);
  if (!db || db.ratio < db.warnRatio || hidden) return null;
  const pct = fmtPct(db.ratio);
  return (
    <div data-testid="db-quota-notice" role="status" className="pointer-events-none absolute inset-x-0 top-14 z-30 flex justify-center px-3">
      <div className="pointer-events-auto flex max-w-xl items-center gap-3 rounded-2xl border border-rule bg-card px-3 py-2 text-sm shadow-lg">
        <RinneFigure mood="waiting" size="bar" className="rn-bar-fig -my-1 shrink-0" standalone />
        <span className="min-w-0 flex-1">{fill(dbCopy.dbQuota.warn, { pct })}</span>
        <Link href="/settings#db" className="btn-primary shrink-0 !px-3 !py-1 text-xs" onClick={() => setHidden(true)}>
          {dbCopy.dbQuota.goClean}
        </Link>
        <button
          type="button"
          className="btn-ghost shrink-0 !px-2 !py-1 text-xs"
          onClick={() => {
            localStorage.setItem(KEY, String(Date.now()));
            setHidden(true);
          }}
        >
          {dbCopy.dbQuota.later}
        </button>
      </div>
    </div>
  );
}
