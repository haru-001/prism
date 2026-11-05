"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useRef } from "react";
import { DEFAULT_PREFS, RINNE_COOKIE, prefsCookie, type OutfitId, type RinneMotion, type RinnePrefs } from "@/lib/rinne";

interface RinneCtx extends RinnePrefs {
  /** 当前是否要动效（已经算上系统的「减少动态效果」） */
  animate: boolean;
  setPrefs: (p: Partial<RinnePrefs>) => void;
}

const Ctx = createContext<RinneCtx>({ ...DEFAULT_PREFS, animate: true, setPrefs: () => {} });

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
    set((p) => (p.outfit === initial.outfit && p.motion === initial.motion && p.show === initial.show ? p : initial));
  }, [initial.outfit, initial.motion, initial.show]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const value = useMemo(() => ({ ...prefs, animate, setPrefs }), [prefs, animate, setPrefs]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRinne() {
  return useContext(Ctx);
}

export type { OutfitId, RinneMotion };
