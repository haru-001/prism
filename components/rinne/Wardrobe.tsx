"use client";

import { useState } from "react";
import { OUTFITS, figureSrc, moodAlt, thumbSrc, type OutfitId, type RinneMotion } from "@/lib/rinne";
import { prefetchOutfit } from "@/lib/client/rinne-load";
import { Toggle } from "@/components/ui";
import { useRinne } from "./RinneProvider";
import { RinneFigure } from "./RinneFigure";

const MOTIONS: { v: RinneMotion; t: string }[] = [
  { v: "system", t: "跟随系统" },
  { v: "on", t: "开" },
  { v: "off", t: "关" },
];

/**
 * 设置里的「形象 / 衣柜」：九套服装，选择存在设置里。
 * 悬停（或键盘聚焦）缩略图时左边先预览那一套，移开就回到当前这套；点下去才真正换上。
 * 打开「自动换装」后按时间和季节自动挑（深夜居家、周末运动或便装、周五周六晚上礼服……），选中的那套作为工作日白天的默认。
 */
export function Wardrobe() {
  const { outfit, chosen, motion, show, auto, setPrefs } = useRinne();
  const [hover, setHover] = useState<OutfitId | null>(null);
  const pick = (o: OutfitId) => {
    setHover(null);
    setPrefs({ outfit: o });
  };
  const warm = (o: OutfitId) => {
    prefetchOutfit(o, ["welcome"], "md");
    setHover(o);
  };
  const preview = hover ?? outfit;
  const cur = OUTFITS.find((o) => o.id === preview);
  return (
    <div className="grid gap-5 sm:grid-cols-[auto,1fr]" data-testid="wardrobe">
      <div className="flex justify-center sm:block">
        <div className="flex flex-col items-center gap-1">
          <RinneFigure mood="welcome" size="md" outfit={preview} standalone className="rn-wd-preview" />
          <div className="text-xs text-muted" data-testid="wardrobe-current">
            {hover && hover !== outfit ? `预览：${cur?.name}` : `${cur?.name}${auto && outfit !== chosen ? "（自动换装）" : ""}`}
          </div>
        </div>
      </div>
      <div className="min-w-0">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="棱音的服装">
          {OUTFITS.map((o) => {
            const t = thumbSrc(o.id);
            const on = o.id === chosen;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                data-outfit={o.id}
                onPointerEnter={() => warm(o.id)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => warm(o.id)}
                onBlur={() => setHover(null)}
                onTouchStart={() => warm(o.id)}
                onClick={() => pick(o.id)}
                className={`group overflow-hidden rounded-xl border text-left transition ${
                  on ? "border-[var(--acc)] ring-2 ring-[var(--acc)]/40" : "border-rule hover:border-[var(--acc)]/60"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={t.src}
                  srcSet={t.srcSet}
                  alt={moodAlt(o.id, "welcome")}
                  width={120}
                  height={160}
                  loading="lazy"
                  decoding="async"
                  className="rn-thumb block aspect-[3/4] w-full object-contain"
                />
                <div className="px-1.5 py-1">
                  <div className="truncate text-[12px] font-medium">{o.name}</div>
                  <div className="truncate text-[10px] text-muted">{o.note}</div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex items-center gap-3">
            <Toggle on={show} onChange={(v) => setPrefs({ show: v })} />
            <span>在界面里显示棱音的立绘</span>
          </div>
          <div className="flex items-start gap-3">
            <Toggle on={auto} onChange={(v) => setPrefs({ auto: v })} />
            <span>
              自动换装
              <span className="block text-xs text-muted">深夜换居家服，周末换运动装或便装，周五、周六晚上换礼服，冬天换针织；工作日白天穿上面选中的那套。</span>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">换装动效</span>
            {MOTIONS.map((m) => (
              <button key={m.v} type="button" className={`chip px-3 py-1 text-xs ${motion === m.v ? "chip-on" : ""}`} onClick={() => setPrefs({ motion: m.v })}>
                {m.t}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">「跟随系统」时，系统开了「减少动态效果」就直接替换，不做淡入。</p>
        </div>
      </div>
    </div>
  );
}

/** 预览图地址（测试和 README 用） */
export const wardrobePreview = (o: OutfitId) => figureSrc(o, "welcome", "md").src;
