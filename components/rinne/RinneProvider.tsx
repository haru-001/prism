"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useRef } from "react";
import { DEFAULT_PREFS, RINNE_COOKIE, autoPool, isOutfit, prefsCookie, slotEndsAt, type OutfitId, type RinneMotion, type RinnePrefs } from "@/lib/rinne";

interface RinneCtx extends RinnePrefs {
  /** 当前是否要动效（已经算上系统的「减少动态效果」） */
  animate: boolean;
  /** 衣柜里选的那套（outfit 是实际显示的那套，开了自动换装时两者可能不同） */
  chosen: OutfitId;
  /** 开着自动换装时手动换上的那套会保持到这个时间（当前时段结束），之后恢复自动；没有手动固定时为 null */
  pinnedUntil: number | null;
  setPrefs: (p: Partial<RinnePrefs>) => void;
}

const Ctx = createContext<RinneCtx>({ ...DEFAULT_PREFS, chosen: DEFAULT_PREFS.outfit, pinnedUntil: null, animate: true, setPrefs: () => {} });

const AUTO_SESSION = "prism_rinne_auto"; // 本次访问：{ slot, outfit }
const AUTO_LAST = "prism_rinne_auto_last"; // 上次访问穿的那套
const AUTO_PIN = "prism_rinne_pin"; // 自动换装开着时手动换上的那套：{ slot, outfit, until }

type Pin = { slot: string; outfit: OutfitId; until: number };
function readPin(): Pin | null {
  try {
    const p = JSON.parse(localStorage.getItem(AUTO_PIN) || "null") as Partial<Pin> | null;
    // 只看到期时间（当前时段结束），不比 slot：深夜时段跨过零点 slot 名会变，但还是同一个时段
    if (p && isOutfit(p.outfit) && typeof p.until === "number" && p.until > Date.now() && p.until - Date.now() < 24 * 3600 * 1000) return p as Pin;
  } catch {}
  return null;
}
function writePin(outfit: OutfitId | null, base: OutfitId) {
  try {
    if (!outfit) localStorage.removeItem(AUTO_PIN);
    else localStorage.setItem(AUTO_PIN, JSON.stringify({ slot: autoPool(base).slot, outfit, until: slotEndsAt().getTime() }));
  } catch {}
}

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

/**
 * 自动换装：挂载后挑一套，之后每分钟看一次是否跨了时段（跨了才换，带淡入淡出）。
 * 手动在衣柜里点了一套时，这套固定到当前时段结束（不然点了看不到变化，像是没保存上），下个时段恢复自动。
 */
function useAutoOutfit(on: boolean, base: OutfitId, pinVer: number) {
  const [cur, setCur] = useState<{ outfit: OutfitId; pin: Pin | null } | null>(null);
  useEffect(() => {
    if (!on) {
      setCur(null);
      return;
    }
    const tick = () => {
      const pin = readPin();
      setCur({ outfit: pin ? pin.outfit : pickAuto(base), pin });
    };
    tick();
    const t = setInterval(tick, 60 * 1000);
    // 别的标签页换了衣服也跟着变
    const onStorage = (e: StorageEvent) => (e.key === AUTO_PIN || e.key === null) && tick();
    window.addEventListener("storage", onStorage);
    return () => {
      clearInterval(t);
      window.removeEventListener("storage", onStorage);
    };
  }, [on, base, pinVer]);
  return { outfit: on && cur ? cur.outfit : base, pinnedUntil: on && cur?.pin ? cur.pin.until : null };
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
  // 设置从服务端变了（比如另一个标签页改了）就跟着变；比本地这份旧的不要（迟到的响应、旧缓存）
  useEffect(() => {
    set((p) =>
      (p.outfit === initial.outfit && p.motion === initial.motion && p.show === initial.show && p.auto === initial.auto) || initial.at < p.at ? p : initial,
    );
  }, [initial.outfit, initial.motion, initial.show, initial.auto, initial.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pinVer, setPinVer] = useState(0);
  const reduce = useSystemReduce();
  const cur = useRef(prefs);
  cur.current = prefs;
  const setPrefs = useCallback(
    (patch: Partial<RinnePrefs>) => {
      const next = { ...cur.current, ...patch, at: Date.now() };
      // 自动换装开着时手动选衣服：这套固定到当前时段结束；关掉自动或重新打开时清掉固定
      if (next.auto && patch.outfit) writePin(patch.outfit, next.outfit);
      if ("auto" in patch) writePin(null, next.outfit);
      if (patch.outfit || "auto" in patch) setPinVer((v) => v + 1);
      cur.current = next;
      set(next);
      writeRinneCookie(next);
      onChange?.(next);
    },
    [onChange],
  );
  const animate = prefs.motion === "on" ? true : prefs.motion === "off" ? false : !reduce;
  const { outfit, pinnedUntil } = useAutoOutfit(prefs.auto, prefs.outfit, pinVer);
  const value = useMemo(
    () => ({ ...prefs, outfit, chosen: prefs.outfit, pinnedUntil, animate, setPrefs }),
    [prefs, outfit, pinnedUntil, animate, setPrefs],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRinne() {
  return useContext(Ctx);
}

export type { OutfitId, RinneMotion };
