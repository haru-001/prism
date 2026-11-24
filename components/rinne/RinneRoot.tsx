"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useApp } from "@/components/AppContext";
import { toast } from "@/components/ui";
import { DEFAULT_PREFS, isMotion, isOutfit, type RinnePrefs } from "@/lib/rinne";
import type { Settings } from "@/lib/types";
import { RinneProvider } from "./RinneProvider";
import { RinneIdlePrefetch } from "./RinneIdlePrefetch";

function fromSettings(s: Settings, cookie: RinnePrefs): RinnePrefs {
  const at = typeof s.rinneAt === "number" ? s.rinneAt : 0;
  return {
    outfit: isOutfit(s.rinneOutfit) ? s.rinneOutfit : cookie.outfit,
    motion: isMotion(s.rinneMotion) ? s.rinneMotion : cookie.motion,
    show: typeof s.rinneShow === "boolean" ? s.rinneShow : cookie.show,
    // 旧数据（没有 rinneAt）里的 rinneAuto=false 是当时的默认值：按新默认（开）处理
    auto: at && typeof s.rinneAuto === "boolean" ? s.rinneAuto : DEFAULT_PREFS.auto,
    at,
  };
}

const toBody = (p: RinnePrefs): Partial<Settings> => ({ rinneOutfit: p.outfit, rinneMotion: p.motion, rinneShow: p.show, rinneAuto: p.auto, rinneAt: p.at });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 登录后的形象设置：服务端设置和浏览器 cookie 谁新用谁。
 * 以前只认服务端：保存请求失败（数据库休眠、网络抖动）或多实例读到旧缓存时，刷新后衣服会变回去，看起来像「保存失败」。
 * 现在 cookie 带修改时间，服务端更旧就用 cookie 并自动补存；保存失败会重试 3 次，还不行才提示。
 * 必须放在 AppProvider 里面。
 */
export function RinneAppRoot({ cookie, children }: { cookie: RinnePrefs; children: React.ReactNode }) {
  const { settings, updateSettings } = useApp();
  const server = fromSettings(settings, cookie);
  const useCookie = cookie.at > server.at;
  const initial = useCookie ? cookie : server;
  const stable = useMemo(() => initial, [initial.outfit, initial.motion, initial.show, initial.auto, initial.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const latest = useRef(0);
  const save = useCallback(
    async (p: RinnePrefs) => {
      latest.current = p.at;
      for (let i = 0; i < 4; i++) {
        if (latest.current !== p.at) return; // 又改了一次，交给新的那次去存
        try {
          await updateSettings(toBody(p));
          return;
        } catch {
          if (i < 3) await sleep([1000, 3000, 8000][i]);
        }
      }
      if (latest.current === p.at) toast("棱音的服装没能存到服务器，这台设备已经记住了，下次打开会自动补存", "err");
    },
    [updateSettings],
  );

  // 服务端比 cookie 旧（上次没存上，或者在别的设备上没改过）：补存一次
  const synced = useRef(false);
  useEffect(() => {
    if (useCookie && cookie.at && !synced.current) {
      synced.current = true;
      void save(cookie);
    }
  }, [useCookie, cookie, save]);

  const onChange = useCallback((p: RinnePrefs) => void save(p), [save]);
  return (
    <RinneProvider initial={stable} onChange={onChange}>
      {children}
      <RinneIdlePrefetch level={1} />
    </RinneProvider>
  );
}

/** 登录页、引导页、休眠页：只有 cookie 可读 */
export function RinneCookieRoot({ cookie, children }: { cookie: RinnePrefs; children: React.ReactNode }) {
  return (
    <RinneProvider initial={cookie}>
      {children}
      <RinneIdlePrefetch />
    </RinneProvider>
  );
}
