/**
 * 棱音的台词气泡，放在舞台场景左边的界面块里，连线从它右边接到她的手或道具。
 * 连线的高度由场景的 ly 决定，气泡第一行大约在 20–30px。
 */
export function RinneBubble({
  children,
  tone = "normal",
  title,
  className = "",
}: {
  children: React.ReactNode;
  tone?: "normal" | "bad" | "ok";
  title?: React.ReactNode;
  className?: string;
}) {
  const border = tone === "bad" ? "border-bad/40" : tone === "ok" ? "border-ok/40" : "border-rule";
  return (
    <div className={`rounded-2xl rounded-tr-md border ${border} bg-card px-4 py-3 text-sm leading-relaxed shadow-sm ${className}`} data-rinne-say="">
      {title ? <div className="mb-1 text-[13px] font-semibold">{title}</div> : null}
      <div aria-live="polite">{children}</div>
    </div>
  );
}
