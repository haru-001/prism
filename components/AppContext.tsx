"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationMeta, ModelGroup, Onboarding, Preset, PublicChannel, Settings } from "@/lib/types";
import { api } from "@/lib/client/api";
import { callName } from "@/lib/copy";

export interface Flags {
  envPassword: boolean;
  envToken: boolean;
  storage: "mysql" | "local";
  blob: boolean;
  problems: string[];
}

export interface Boot {
  settings: Settings;
  onboarding: Onboarding;
  channels: PublicChannel[];
  catalog: ModelGroup[];
  /** 提示词预设（新建会话时选用） */
  presets: Preset[];
  flags: Flags;
  /** 数据库容量快照（没用 MySQL 时为 null） */
  db?: { usedBytes: number; quotaBytes: number; at: number; ratio: number; warnRatio: number } | null;
}

export type Theme = "system" | "light" | "dark";

interface Ctx extends Boot {
  ready: boolean;
  name: string;
  conversations: ConversationMeta[];
  /** 会话列表是否已经拿到（没拿到时左栏用 convPromise 流式渲染） */
  conversationsLoaded: boolean;
  convPromise: Promise<ConversationMeta[]> | null;
  refresh: () => Promise<void>;
  /** 乐观更新：先在本地改，再等服务端确认 */
  patchBoot: (fn: (b: Boot) => Boot) => void;
  refreshConversations: () => Promise<void>;
  /**
   * 在后台直接读库刷新预设列表（不挡页面渲染）。
   * 多实例部署时，页面可能由另一个实例渲染，它内存里的预设最多晚 30 秒才更新；空白页和设置页打开后用它补一次。
   * force=false 时 10 秒内只读一次。
   */
  revalidatePresets: (force?: boolean) => Promise<void>;
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
  presets: [],
  flags: { envPassword: false, envToken: false, storage: "local", blob: false, problems: [] },
};

export function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function AppProvider({
  children,
  initialBoot,
  initialConversations,
}: {
  children: React.ReactNode;
  /** 服务端渲染时已经读好的启动数据：首屏直接带着模型列表和设置出来，不用等浏览器再请求一次 */
  initialBoot?: Boot;
  /** 服务端开始读的会话列表（不等它读完就先把页面发下来，读完后随同一个响应流式补上） */
  initialConversations?: Promise<ConversationMeta[]>;
}) {
  const [boot, setBoot] = useState<Boot>(initialBoot || emptyBoot);
  const [ready, setReady] = useState(!!initialBoot);
  const [conversations, setConversationsState] = useState<ConversationMeta[]>([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const setConversations = useCallback<React.Dispatch<React.SetStateAction<ConversationMeta[]>>>((v) => {
    setConversationsLoaded(true);
    setConversationsState(v);
  }, []);
  const [theme, setThemeState] = useState<Theme>("system");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 改完配置后的刷新：fresh 让服务端直接读库，多实例时也不会读到旧缓存
  const refresh = useCallback(async () => {
    const b = await api<Boot>("/api/bootstrap?fresh=1");
    setBoot(b);
    setReady(true);
  }, []);
  const patchBoot = useCallback((fn: (b: Boot) => Boot) => setBoot(fn), []);

  const presetsCheckedAt = useRef(0);
  const revalidatePresets = useCallback(async (force = false) => {
    if (!force && Date.now() - presetsCheckedAt.current < 10_000) return;
    presetsCheckedAt.current = Date.now();
    try {
      const r = await api<{ presets: Preset[] }>("/api/presets?fresh=1");
      setBoot((b) => (JSON.stringify(b.presets) === JSON.stringify(r.presets) ? b : { ...b, presets: r.presets }));
    } catch {
      presetsCheckedAt.current = 0;
    }
  }, []);

  const refreshConversations = useCallback(async () => {
    const r = await api<{ conversations: ConversationMeta[] }>("/api/conversations");
    setConversations(r.conversations);
  }, [setConversations]);

  useEffect(() => {
    if (!initialBoot) void refresh();
    if (initialConversations) {
      // 服务端传来的是 React 的 thenable，不一定是完整的 Promise，先包一层
      Promise.resolve(initialConversations).then(
        (list) => setConversationsState((cur) => [...cur, ...list.filter((x) => !cur.some((c) => c.id === x.id))]),
        () => void refreshConversations(),
      ).finally(() => setConversationsLoaded(true));
    } else void refreshConversations();
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

  // 设置的保存排队一个接一个发：服务端是「读出→合并→写回」，两次保存同时在路上时后一次会盖掉前一次
  const settingsQueue = useRef<Promise<unknown>>(Promise.resolve());
  const updateSettings = useCallback(async (p: Partial<Settings>) => {
    setBoot((b) => ({ ...b, settings: { ...b.settings, ...p } }));
    const run = settingsQueue.current.catch(() => {}).then(() => api<{ settings: Settings }>("/api/settings", { method: "PUT", body: p }));
    settingsQueue.current = run;
    const r = await run;
    // 后面还有排队的保存时先不用服务端结果覆盖界面，等最后一次的结果
    if (settingsQueue.current === run) setBoot((b) => ({ ...b, settings: r.settings }));
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
      conversationsLoaded,
      convPromise: initialConversations || null,
      refresh,
      patchBoot,
      refreshConversations,
      revalidatePresets,
      setConversations,
      updateSettings,
      seen,
      markTip,
      theme,
      setTheme,
      sidebarOpen,
      setSidebarOpen,
    }),
    [boot, ready, conversations, conversationsLoaded, initialConversations, refresh, patchBoot, refreshConversations, revalidatePresets, setConversations, updateSettings, seen, markTip, theme, setTheme, sidebarOpen],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp 必须在 AppProvider 内使用");
  return c;
}
