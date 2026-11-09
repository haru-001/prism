"use client";

import { useCallback } from "react";
import { useApp } from "@/components/AppContext";
import { isMotion, isOutfit, type RinnePrefs } from "@/lib/rinne";
import { RinneProvider } from "./RinneProvider";
import { RinneIdlePrefetch } from "./RinneIdlePrefetch";

/**
 * 登录后的形象设置：以服务端的设置为准（没存过就沿用 cookie 里的），改动存回设置。
 * 必须放在 AppProvider 里面。
 */
export function RinneAppRoot({ cookie, children }: { cookie: RinnePrefs; children: React.ReactNode }) {
  const { settings, updateSettings } = useApp();
  const initial: RinnePrefs = {
    outfit: isOutfit(settings.rinneOutfit) ? settings.rinneOutfit : cookie.outfit,
    motion: isMotion(settings.rinneMotion) ? settings.rinneMotion : cookie.motion,
    show: typeof settings.rinneShow === "boolean" ? settings.rinneShow : cookie.show,
    auto: typeof settings.rinneAuto === "boolean" ? settings.rinneAuto : cookie.auto,
  };
  const onChange = useCallback(
    (p: RinnePrefs) => {
      updateSettings({ rinneOutfit: p.outfit, rinneMotion: p.motion, rinneShow: p.show, rinneAuto: p.auto }).catch(() => {});
    },
    [updateSettings],
  );
  return (
    <RinneProvider initial={initial} onChange={onChange}>
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
