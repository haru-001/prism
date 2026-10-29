"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ConversationMeta, ModelGroup, Onboarding, PublicChannel, Settings } from "@/lib/types";
import { api } from "@/lib/client/api";
import { callName } from "@/lib/copy";

export interface Flags {
  envPassword: boolean;
  envToken: boolean;
  storage: "mysql" | "local";
  blob: boolean;
  problems: string[];
}

interface Boot {
  settings: Settings;
  onboarding: Onboarding;
  channels: PublicChannel[];
  catalog: ModelGroup[];
  flags: Flags;
}

export type Theme = "system" | "light" | "dark";

interface Ctx extends Boot {
  ready: boolean;
  name: string;
  conversations: ConversationMeta[];
  refresh: () => Promise<void>;
  refreshConversations: () => Promise<void>;
  setConversations: React.Dispatch<React.SetStateAction<ConversationMeta[]>>;
  updateSettings: (p: Partial<Settings>) => Promise<void>;
  seen: (tip: string) => boolean;
  markTip: (tip: string) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
}

const AppCtx = createContext<Ctx | null>(null);

const emptyBoot: Boot = {
  settings: { callMode: "you", customName: "", personaInModel: false, defaultSystem: "", temperature: 0.7 },
  onboarding: { completed: true, seenTips: [] },
  channels: [],
  catalog: [],
  flags: { envPassword: false, envToken: false, storage: "local", blob: false, problems: [] },
};

export function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [boot, setBoot] = useState<Boot>(emptyBoot);
  const [ready, setReady] = useState(false);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [theme, setThemeState] = useState<Theme>("system");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const refresh = useCallback(async () => {
    const b = await api<Boot>("/api/bootstrap");
    setBoot(b);
    setReady(true);
  }, []);

  const refreshConversations = useCallback(async () => {
    const r = await api<{ conversations: ConversationMeta[] }>("/api/conversations");
    setConversations(r.conversations);
  }, []);

  useEffect(() => {
    void refresh();
    void refreshConversations();
    // 恢复主题偏好
    const t = (localStorage.getItem("prism-theme") as Theme) || "system";
    setThemeState(t);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme((localStorage.getItem("prism-theme") as Theme) || "system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [refresh, refreshConversations]);

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem("prism-theme", t);
    setThemeState(t);
    applyTheme(t);
  }, []);

  const updateSettings = useCallback(async (p: Partial<Settings>) => {
    setBoot((b) => ({ ...b, settings: { ...b.settings, ...p } }));
    const r = await api<{ settings: Settings }>("/api/settings", { method: "PUT", body: p });
    setBoot((b) => ({ ...b, settings: r.settings }));
  }, []);

  const seen = useCallback((tip: string) => boot.onboarding.seenTips.includes(tip), [boot.onboarding.seenTips]);

  const markTip = useCallback((tip: string) => {
    setBoot((b) => (b.onboarding.seenTips.includes(tip) ? b : { ...b, onboarding: { ...b.onboarding, seenTips: [...b.onboarding.seenTips, tip] } }));
    void api("/api/onboarding", { method: "PUT", body: { tip } }).catch(() => {});
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      ...boot,
      ready,
      name: callName(boot.settings.callMode, boot.settings.customName),
      conversations,
      refresh,
      refreshConversations,
      setConversations,
      updateSettings,
      seen,
      markTip,
      theme,
      setTheme,
      sidebarOpen,
      setSidebarOpen,
    }),
    [boot, ready, conversations, refresh, refreshConversations, updateSettings, seen, markTip, theme, setTheme, sidebarOpen],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp 必须在 AppProvider 内使用");
  return c;
}
