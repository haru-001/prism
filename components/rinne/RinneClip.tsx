"use client";

import { useEffect, useRef, useState } from "react";
import { bustMeta, moodMeta, type Mood, type OutfitId } from "@/lib/rinne";

/**
 * 棱音短视频：叠在同一状态的静态立绘上面（视频首尾帧就是这张母版，像素对齐），播完停在首帧，和静态图无缝。
 * - idle-blink（等待状态，眨眼）、login-wave（欢迎状态，挥手/眨眼）、image-done（成功状态，笑）
 * - 每套服装各一段，WebM VP9 带透明通道，单段约 10–30KB
 * - replay：播完隔多少毫秒再播一次（0 = 只播一次）
 * - 不播的情况：关掉动效 / 系统减少动态效果、Safari（VP9 透明支持不稳定）、不支持 VP9、加载出错，这时只剩静态图
 */
export type ClipId = "idle-blink" | "login-wave" | "image-done";
export const CLIP_MOOD: Record<ClipId, Mood> = { "idle-blink": "waiting", "login-wave": "welcome", "image-done": "success" };

let support: boolean | null = null;
function canPlayAlpha() {
  if (support !== null) return support;
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const safari = /Safari\//.test(ua) && !/(Chrome|Chromium|CriOS|Edg|Firefox|FxiOS)\//.test(ua);
  const v = document.createElement("video");
  support = !safari && !!v.canPlayType('video/webm; codecs="vp9"');
  return support;
}

export function RinneClip({ clip, outfit, bust, replay = 0 }: { clip: ClipId; outfit: OutfitId; bust: boolean; replay?: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(canPlayAlpha()), []);
  useEffect(() => {
    const v = ref.current;
    if (!ok || !v) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ended = () => {
      v.currentTime = 0;
      if (replay > 0) t = setTimeout(() => v.play().catch(() => {}), replay);
    };
    v.addEventListener("ended", ended);
    v.play().catch(() => {});
    return () => {
      v.removeEventListener("ended", ended);
      if (t) clearTimeout(t);
    };
  }, [ok, replay, clip, outfit]);
  if (!ok) return null;
  const mood = CLIP_MOOD[clip];
  const lb = bust ? { ...bustMeta(outfit, mood), ar: moodMeta(outfit, mood).ar } : null;
  return (
    <video
      ref={ref}
      key={`${outfit}/${clip}`}
      className="rn-layer rn-clip"
      src={`/img/rinne/clips/${outfit}/${clip}.webm`}
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      data-rinne-clip={`${outfit}/${clip}`}
      onError={() => setOk(false)}
      style={{ zIndex: 2, ...(lb ? { "--ty": lb.ty, "--bx": lb.bx, "--lar": lb.ar, width: `calc(var(--H) / var(--k) * ${lb.ar})` } : { width: "auto" }) } as React.CSSProperties}
    />
  );
}
