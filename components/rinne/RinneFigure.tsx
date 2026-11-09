"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BUST_K, bustMeta, figureSrc, isBust, moodAlt, moodMeta, type Mood, type OutfitId, type StageSize } from "@/lib/rinne";
import { preloadFigure } from "@/lib/client/rinne-load";
import { useRinne } from "./RinneProvider";
import { CLIP_MOOD, RinneClip, type ClipId } from "./RinneClip";

const FADE_MS = 240;

interface Layer {
  key: number;
  outfit: OutfitId;
  mood: Mood;
  /** enter：已挂上但透明，等 decode；in：正在淡入；shown：已显示 */
  phase: "enter" | "in" | "shown";
}

/**
 * 一张棱音立绘。换装或换状态时：
 * 1. 先在后台把新图下载并 decode 完（旧图一直留在原处）
 * 2. 新图叠在旧图上方，从透明淡入（240ms）；旧图同时淡出，但曲线更晚（ease-in），交叉的瞬间两张合起来仍接近不透明，
 *    不闪底色；立绘是透明图，旧图不淡出的话会从新图的空白处透出来形成重影
 * 3. 淡入结束后移除旧图
 * 连续快速切换时只认最后一次：较早的请求 decode 完了也不会再挂上去。
 * 关掉动效（或系统开了「减少动态效果」）时，decode 完直接替换。
 * 容器用固定高度 + 按比例算出的宽度占位，图片加载前后布局不跳。
 * 每张图按自己的比例、底边居中摆放，换装时新旧两张宽度不同也不会被拉伸。
 * 半身档（xs / bar / chat）：图片放大到 1/BUST_K，按头顶和头部中心对齐，只露出头顶到腰这一段，下沿渐隐。
 */
export function RinneFigure({
  mood,
  size,
  outfit: forcedOutfit,
  priority = false,
  mobileH,
  className = "",
  standalone = false,
  clip,
  replay,
}: {
  mood: Mood;
  size: StageSize;
  outfit?: OutfitId;
  /** 首屏的主立绘：eager + fetchpriority=high；其余 lazy */
  priority?: boolean;
  mobileH?: number;
  className?: string;
  /** 不在 RinneScene 里单独用（toast、提醒条）时为 true，自带尺寸档的高度 */
  standalone?: boolean;
  /** 这个状态有短视频时叠在静态图上播（见 RinneClip） */
  clip?: ClipId;
  replay?: number;
}) {
  const r = useRinne();
  const outfit = forcedOutfit ?? r.outfit;
  const [layers, setLayers] = useState<Layer[]>(() => [{ key: 0, outfit, mood, phase: "shown" }]);
  const seq = useRef(0);
  const started = useRef(new Set<number>());
  const animateRef = useRef(r.animate);
  animateRef.current = r.animate;

  useEffect(() => {
    const id = ++seq.current;
    let alive = true;
    setLayers((ls) => {
      const top = ls[ls.length - 1];
      // 已经是这张（或正在淡入这张）：只丢掉还没显示的待定层
      if (top.outfit === outfit && top.mood === mood) return ls;
      return ls.filter((l) => l.phase !== "enter");
    });
    preloadFigure(outfit, mood, size, mobileH).then(() => {
      if (!alive || id !== seq.current) return; // 有更新的切换，这次作废
      setLayers((ls) => {
        const top = ls[ls.length - 1];
        if (top.outfit === outfit && top.mood === mood) return ls;
        const base = ls.filter((l) => l.phase !== "enter");
        return [...base, { key: id, outfit, mood, phase: "enter" }];
      });
    });
    return () => {
      alive = false;
    };
  }, [outfit, mood, size, mobileH]);

  const finish = useCallback((key: number) => {
    setLayers((ls) => {
      const i = ls.findIndex((l) => l.key === key);
      if (i < 0) return ls;
      // 这一层之下的都不再需要
      return ls.slice(i).map((l) => (l.key === key ? { ...l, phase: "shown" } : l));
    });
  }, []);

  const onReady = useCallback(
    (key: number, el: HTMLImageElement | null) => {
      if (!el || started.current.has(key)) return;
      started.current.add(key);
      const go = () => {
        if (!animateRef.current) {
          finish(key);
          return;
        }
        requestAnimationFrame(() => {
          setLayers((ls) => ls.map((l) => (l.key === key && l.phase === "enter" ? { ...l, phase: "in" } : l)));
          // transitionend 在后台标签页可能不触发，兼一个定时器
          setTimeout(() => finish(key), FADE_MS + 80);
        });
      };
      // 确保页面里这个 <img> 自己也 decode 好了再淡入
      (el.decode ? el.decode() : Promise.resolve()).then(go, go);
    },
    [finish],
  );

  const top = layers[layers.length - 1];
  const shownTop = [...layers].reverse().find((l) => l.phase !== "enter") ?? top;
  // 容器宽度跟目标这张图（不同服装的同一状态动作不同、比例不同），宽度变化有过渡
  const meta = moodMeta(top.outfit, top.mood);
  const bust = isBust(size);
  // 正在淡入的那层之下的旧图同时淡出（立绘是透明图，旧图不淡出会从新图的空白处透出来，形成重影）
  const inAt = layers.findIndex((l) => l.phase === "in");

  return (
    <span
      className={`rn-fig ${bust ? "rn-bust" : ""} ${standalone ? `rn-${size}` : ""} ${className}`}
      data-outfit={shownTop.outfit}
      data-mood={shownTop.mood}
      data-pending={top.phase === "enter" ? `${top.outfit}/${top.mood}` : undefined}
      style={{ "--ar": meta.ar, "--rn-fade": r.animate ? `${FADE_MS}ms` : "0ms", ...(bust ? { "--k": BUST_K } : {}) } as React.CSSProperties}
    >
      {layers.map((l, i) => {
        const s = figureSrc(l.outfit, l.mood, size, mobileH);
        const first = i === 0 && l.key === 0;
        // 半身档：每层按自己这张图的头顶 / 头部中心定位（新旧两张动作不同）
        const lb = bust ? { ...bustMeta(l.outfit, l.mood), ar: moodMeta(l.outfit, l.mood).ar } : null;
        return (
          // <picture>：支持 AVIF 的浏览器取 AVIF（小约三成），其余取 WebP；两组都是同样的宽度档
          <picture key={l.key} className="rn-pic">
            <source type="image/avif" srcSet={s.avifSrcSet} sizes={s.sizes} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.src}
              srcSet={s.srcSet}
              sizes={s.sizes}
              width={s.width}
              height={s.height}
              alt={l === shownTop ? moodAlt(l.outfit, l.mood) : ""}
              aria-hidden={l === shownTop ? undefined : true}
              draggable={false}
              decoding="async"
              loading={first && !priority ? "lazy" : "eager"}
              fetchPriority={first && priority ? "high" : undefined}
              className={`rn-layer ${l.phase === "enter" ? "rn-enter" : l.phase === "in" ? "rn-in" : inAt > i ? "rn-out" : ""}`}
              style={{ transitionDuration: r.animate ? `${FADE_MS}ms` : "0ms", ...(lb ? { "--ty": lb.ty, "--bx": lb.bx, "--lar": lb.ar } : {}) } as React.CSSProperties}
              ref={l.phase === "enter" ? (el) => onReady(l.key, el) : undefined}
              onTransitionEnd={l.phase === "in" ? () => finish(l.key) : undefined}
              data-rinne-img={`${l.outfit}/${l.mood}`}
            />
          </picture>
        );
      })}
      {clip && r.animate && shownTop === top && top.phase === "shown" && top.mood === CLIP_MOOD[clip] && (
        <RinneClip clip={clip} outfit={top.outfit} bust={bust} replay={replay} />
      )}
    </span>
  );
}
