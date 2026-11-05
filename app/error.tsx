"use client";

import { IdolAvatar } from "@/components/Logo";
import { DbSleeping } from "@/components/DbLazy";
import { kindFromDigest } from "@/lib/dbdown";

/** 页面出错时不白屏：数据库连不上就显示「数据库睡着了」，其他错误显示棱音的提示和重试按钮 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const kind = kindFromDigest(error.digest);
  if (kind) return <DbSleeping kind={kind} />;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <IdolAvatar size={72} />
      <h1 className="text-xl font-bold">舞台出了点小意外</h1>
      <p className="max-w-md text-sm text-muted">页面没能顺利打开，我再试一次？一直这样的话，去 Vercel 的日志里看看具体报错吧。</p>
      {error.digest && <p className="text-xs text-muted">错误编号：{error.digest}</p>}
      <button type="button" className="btn-primary" onClick={() => reset()}>
        重试
      </button>
    </div>
  );
}
