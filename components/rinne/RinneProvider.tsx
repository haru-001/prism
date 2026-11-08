"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useRef } from "react";
import { DEFAULT_PREFS, RINNE_COOKIE, autoPool, isOutfit, prefsCookie, type OutfitId, type RinneMotion, type RinnePrefs } from "@/lib/rinne";

interface RinneCtx extends RinnePrefs {
  /** 当前是否要动效（已经算上系统的「减少动态效果」） */
  animate: boolean;
  /** 衣柜里选的那套（outfit 是实际显示的那套，开了自动换装时两者可能不同） */
  chosen: OutfitId;
  setPrefs: (p: Partial<RinnePrefs>) => void;
}

const Ctx = createContext<RinneCtx>({ ...DEFAULT_PREFS, chosen: DEFAULT_PREFS.outfit, animate: true, setPrefs: () => {} });

const AUTO_SESSION = "prism_rinne_auto"; // 本次访问：{ slot, outfit }
const AUTO_LAST = "prism_rinne_auto_last"; // 上次访问穿的那套

/** 本次访问在这个时段穿哪套：同一时段内不变；新访问或换了时段就从池子里重新随机挑（尽量不和上次一样） */
function pickAuto(base: OutfitId): OutfitId {
  const { slot, pool } = autoPool(base);
  try {
    const s = JSON.parse(sessionStorage.getItem(AUTO_SESSION) || "null") as { slot?: string; outfit?: string; base?: string } | null;
    if (s && s.slot === slot && s.base === base && isOutfit(s.outfit) && pool.includes(s.outfit)) return s.outfit;
  } catch {
    /* 隐私模式等读不到存储：每次都重新挑 */
  }
  let last: string | null = null;
  try {
    last = localStorage.getItem(AUTO_LAST);
  } catch {}
  const cand = pool.length > 1 ? pool.filter((o) => o !== last) : pool;
  const outfit = cand[Math.floor(Math.random() * cand.length)] ?? base;
  try {
    sessionStorage.setItem(AUTO_SESSION, JSON.stringify({ slot, outfit, base }));
    localStorage.setItem(AUTO_LAST, outfit);
  } catch {}
  return outfit;
}

/** 自动换装：挂载后挑一套，之后每 5 分钟看一次是否跨了时段（跨了才换，带淡入淡出） */
function useAutoOutfit(on: boolean, base: OutfitId) {
  const [cur, setCur] = useState<OutfitId | null>(null);
  useEffect(() => {
    if (!on) {
      setCur(null);
      return;
    }
    const tick = () => setCur(pickAuto(base));
    tick();
    const t = setInterval(tick, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [on, base]);
  return on && cur ? cur : base;
}

function useSystemReduce() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduce;
}

export function writeRinneCookie(p: RinnePrefs) {
  document.cookie = `${RINNE_COOKIE}=${encodeURIComponent(prefsCookie(p))}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * 棱音的形象设置：服装、动效、是否显示。
 * initial 来自服务端（设置或 cookie），首屏就是对的服装，不会先闪一下职业装。
 * onChange 由上层把新值存进设置（登录前没有设置，只写 cookie）。
 */
export function RinneProvider({
  initial,
  onChange,
  children,
}: {
  initial: RinnePrefs;
  onChange?: (p: RinnePrefs) => void;
  children: React.ReactNode;
}) {
  const [prefs, set] = useState<RinnePrefs>(initial);
  // 设置从服务端变了（比如另一个标签页改了）就跟着变
  useEffect(() => {
    set((p) => (p.outfit === initial.outfit && p.motion === initial.motion && p.show === initial.show && p.auto === initial.auto ? p : initial));
  }, [initial.outfit, initial.motion, initial.show, initial.auto]); // eslint-disable-line react-hooks/exhaustive-deps
  const reduce = useSystemReduce();
  const cur = useRef(prefs);
  cur.current = prefs;
  const setPrefs = useCallback(
    (patch: Partial<RinnePrefs>) => {
      const next = { ...cur.current, ...patch };
      cur.current = next;
      set(next);
      writeRinneCookie(next);
      onChange?.(next);
    },
    [onChange],
  );
  const animate = prefs.motion === "on" ? true : prefs.motion === "off" ? false : !reduce;
  const outfit = useAutoOutfit(prefs.auto, prefs.outfit);
  const value = useMemo(() => ({ ...prefs, outfit, chosen: prefs.outfit, animate, setPrefs }), [prefs, outfit, animate, setPrefs]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRinne() {
  return useContext(Ctx);
}

export type { OutfitId, RinneMotion };
