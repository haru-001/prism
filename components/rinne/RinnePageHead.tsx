"use client";

import { pageSrc, type PageId } from "@/lib/rinne";
import { IdolSay } from "@/components/ui";
import { RinneBubble } from "./RinneBubble";
import { useRinne } from "./RinneProvider";

/**
 * 功能页页首：左边棱音的台词气泡，右边这一页专属的半身像（头顶到大腿，整张入画，下沿渐隐），
 * 一根渐变线从气泡接到她手里的道具。每套服装每页一张，换装时淡入。
 * 「显示棱音」关掉时退回原来的小头像台词。
 */
export function RinnePageHead({
  page,
  title,
  children,
  tone,
}: {
  page: PageId;
  title?: React.ReactNode;
  children: React.ReactNode;
  tone?: "normal" | "bad" | "ok";
}) {
  const { show, outfit, animate } = useRinne();
  const s = show ? pageSrc(outfit, page) : null;
  if (!s) return <IdolSay>{children}</IdolSay>;
  const { ar, hx, hy } = s.meta;
  return (
    <div
      className={`rn-ph ${animate ? "" : "rn-still"}`}
      style={{ "--ar": ar, "--hx": hx, "--hy": hy } as React.CSSProperties}
      data-testid="rinne-page-head"
      data-rinne-page={page}
      data-outfit={outfit}
    >
      <div className="rn-ph-say">
        <RinneBubble title={title} tone={tone}>
          {children}
        </RinneBubble>
      </div>
      <div className="rn-ph-fig">
        <span className="rn-wire rn-ph-wire" aria-hidden="true" />
        <picture key={`${outfit}/${page}`}>
          <source type="image/avif" srcSet={s.avif} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={s.webp} width={s.width} height={s.height} alt={s.alt} decoding="async" draggable={false} className="rn-ph-img" data-rinne-img={`${outfit}/page-${page}`} />
        </picture>
      </div>
    </div>
  );
}
