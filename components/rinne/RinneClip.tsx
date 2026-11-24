"use client";

import { useEffect, useRef, useState } from "react";
import { bustMeta, moodMeta, type Mood, type OutfitId } from "@/lib/rinne";

/**
 * 棱音短视频：和同一状态的静态立绘放在同一位置，两者只显示其一：
 * 播放中隐藏静态图（立绘和视频都是透明图，同时显示会叠出两只手，形成残影），播完或暂停立刻隐藏视频、换回静态图。
 * - idle-blink（等待状态，眨眼）、login-wave（欢迎状态，挥手/眨眼）、image-done（成功状态，笑）
 * - guide-point（指路状态，抬手示意）、think-loop（思考状态，轻点/低头看）、error-sorry（出错状态，歉意点头）、imaging-work（生图状态，举相机/作画）
 * - 新四段由 scripts/rinne/make_motion_clip.py（立绘上半身动作：前倾、歪头、点头、呼吸，高 860 与 2x 立绘一致）或 make_clip.py（AI 生成视频抠像）生成；
 *   CLIP_FILES 记录实际存在的文件，没有的直接不渲染，不会去请求 404
 * - 每套服装各一段，WebM VP9 带透明通道，单段约 30–250KB
 * - 进入视口才加载和播放（对话里有很多思考 / 出错气泡时不会一起下载），离开视口暂停
 * - replay：播完隔多少毫秒再播一次（0 = 只播一次）
 * - 不播的情况：关掉动效 / 系统减少动态效果、Safari（VP9 透明支持不稳定）、不支持 VP9、加载出错，这时只剩静态图
 */
export type ClipId = "idle-blink" | "login-wave" | "image-done" | "guide-point" | "think-loop" | "error-sorry" | "imaging-work";
export const CLIP_MOOD: Record<ClipId, Mood> = {
  "idle-blink": "waiting",
  "login-wave": "welcome",
  "image-done": "success",
  "guide-point": "guide",
  "think-loop": "thinking",
  "error-sorry": "error",
  "imaging-work": "imaging",
};
/** 状态 → 默认短视频（调用处没指定 clip 时也能自动配上） */
export const MOOD_CLIP: Partial<Record<Mood, ClipId>> = Object.fromEntries(Object.entries(CLIP_MOOD).map(([c, m]) => [m, c])) as Partial<Record<Mood, ClipId>>;

/** public/img/rinne/clips/<outfit>/<clip>.webm 实际存在的文件。补拍一段就在这里加一项（scripts/rinne/make_clip.sh 会提示） */
const BASE: ClipId[] = ["idle-blink", "login-wave", "image-done", "guide-point", "think-loop", "error-sorry", "imaging-work"];
export const CLIP_FILES: Record<OutfitId, ClipId[]> = {
  suit: [...BASE],
  gown: [...BASE],
  summer: [...BASE],
  home: [...BASE],
  trench: [...BASE],
  qipao: [...BASE],
  bridal: [...BASE],
  sport: [...BASE],
  winter: [...BASE],
};
export function hasClip(outfit: OutfitId, clip: ClipId) {
  return CLIP_FILES[outfit]?.includes(clip) ?? false;
}

let support: boolean | null = null;
function canPlayAlpha() {
  if (support !== null) return support;
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const safari = /Safari\//.test(ua) && !/(Chrome|Chromium|CriOS|Edg|Firefox|FxiOS)\//.test(ua);
  const v = document.createElement("video");
  // 省流量模式（Android Chrome 的「精简模式」/ Save-Data）下不下载视频，只显示立绘
  const saveData = !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  support = !safari && !saveData && !!v.canPlayType('video/webm; codecs="vp9"');
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
    const fig = v.closest(".rn-fig");
    // 等第一帧真正画到屏幕上再藏立绘：只听 playing 时偶尔会先藏了立绘、视频还没出帧，闪一下空白
    type RVFC = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    const on = () => {
      const rv = v as RVFC;
      if (rv.requestVideoFrameCallback) rv.requestVideoFrameCallback(() => !v.paused && fig?.classList.add("rn-clip-on"));
      else fig?.classList.add("rn-clip-on");
    };
    // 重播间隔加一点随机，页面上几个棱音不会整齐划一地同时动
    const gap = () => Math.round(replay * (0.8 + Math.random() * 0.6));
    // 换回静态图时不走淡入（否则静态图从透明慢慢出现，人物会闪一下）：临时关掉过渡，两帧后恢复
    const off = () => {
      if (!fig?.classList.contains("rn-clip-on")) return;
      fig.classList.add("rn-clip-swap");
      fig.classList.remove("rn-clip-on");
      requestAnimationFrame(() => requestAnimationFrame(() => fig.classList.remove("rn-clip-swap")));
    };
    const ended = () => {
      off();
      v.currentTime = 0;
      if (replay > 0)
        t = setTimeout(() => {
          t = undefined;
          v.play().catch(() => {});
        }, gap());
    };
    v.addEventListener("playing", on);
    v.addEventListener("pause", off);
    v.addEventListener("ended", ended);
    v.addEventListener("error", off);
    // 进入视口才挂 src 并播放；离开视口暂停（等下次进来从头播）
    let seen = false;
    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (es) => {
              const vis = es.some((e) => e.isIntersecting);
              visible = vis;
              if (vis) {
                if (!seen) {
                  seen = true;
                  if (!v.getAttribute("src") && v.dataset.src) v.src = v.dataset.src;
                }
                if (v.paused && !t && !document.hidden) v.play().catch(off);
              } else if (!v.paused) {
                if (t) clearTimeout(t);
                t = undefined;
                v.pause();
                v.currentTime = 0;
              }
            },
            { rootMargin: "120px" },
          )
        : null;
    // 切到别的标签页 / 最小化时暂停，回来再接着播（省电，也不会回来时一堆动作叠在一起）
    let visible = false;
    const onVis = () => {
      if (document.hidden) {
        if (t) clearTimeout(t);
        t = undefined;
        if (!v.paused) {
          v.pause();
          v.currentTime = 0;
        }
      } else if (visible && v.paused && v.getAttribute("src")) t = setTimeout(() => ((t = undefined), v.play().catch(off)), 400);
    };
    document.addEventListener("visibilitychange", onVis);
    if (io) io.observe(fig ?? v);
    else {
      if (!v.getAttribute("src") && v.dataset.src) v.src = v.dataset.src;
      v.play().catch(off);
    }
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      off();
      v.removeEventListener("playing", on);
      v.removeEventListener("pause", off);
      v.removeEventListener("ended", ended);
      v.removeEventListener("error", off);
      if (t) clearTimeout(t);
    };
  }, [ok, replay, clip, outfit]);
  if (!ok || !hasClip(outfit, clip)) return null;
  const mood = CLIP_MOOD[clip];
  const lb = bust ? { ...bustMeta(outfit, mood), ar: moodMeta(outfit, mood).ar } : null;
  return (
    <video
      ref={ref}
      key={`${outfit}/${clip}`}
      className="rn-layer rn-clip"
      data-src={`/img/rinne/clips/${outfit}/${clip}.webm`}
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
