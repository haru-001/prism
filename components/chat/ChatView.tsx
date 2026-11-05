"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RinneScene } from "@/components/rinne/RinneScene";
import { RinneBubble } from "@/components/rinne/RinneBubble";
import { Check, Code2, Download, Eye, FileDown, HeartPulse, Menu, Palette, ScrollText } from "lucide-react";
import type { ChatMsg, Conversation, ModelGroup, Preset } from "@/lib/types";
import { api, readEvents, uid, notifyDbDown } from "@/lib/client/api";
import { fetchConv, peekConv, putConv, takeInitial } from "@/lib/client/convCache";
import { copy, fill } from "@/lib/copy";
import { useApp } from "../AppContext";
import { IdolAvatar } from "../Logo";
import { toast } from "../ui";
import { ModelPicker, type Picked } from "./ModelPicker";
import { Composer, type ImageOpts } from "./Composer";
import { Coach, MessageItem, loadMarkdown } from "./MessageItem";

function firstModel(catalog: ModelGroup[], wantImage: boolean, prefer?: string): Picked | undefined {
  const live = catalog.filter((g) => !g.disabled);
  if (prefer) {
    for (const g of live) {
      const m = g.models.find((x) => x.id === prefer);
      if (m && m.caps.includes("image") === wantImage) return { model: m.id, channelId: g.channelId };
    }
  }
  for (const g of live) {
    const m = g.models.find((x) => (wantImage ? x.caps.includes("image") : !x.caps.includes("image")));
    if (m) return { model: m.id, channelId: g.channelId };
  }
  return undefined;
}

function Num({ n }: { n: number }) {
  return <span className="num shadow">{n}</span>;
}

export function ChatView({ id: initialId, initial }: { id?: string; initial?: Promise<Conversation | null> }) {
  const app = useApp();
  const { catalog, settings, ready, seen, markTip, name, channels } = app;

  const [convId, setConvId] = useState<string>(initialId || "");
  const [loaded, setLoaded] = useState(!initialId);
  const [notFound, setNotFound] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [title, setTitle] = useState("");
  const [createdAt, setCreatedAt] = useState(Date.now());
  const [system, setSystem] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [mode, setModeState] = useState<"chat" | "image">("chat");
  const [chatModel, setChatModel] = useState<Picked>();
  const [imageModel, setImageModel] = useState<Picked>();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [imageOpts, setImageOpts] = useState<ImageOpts>({ size: "1024x1024", n: 1, quality: "", refs: [] });
  const [streaming, setStreaming] = useState(false);
  const [firstImageTip, setFirstImageTip] = useState(false);
  /** 并排对比：主模型之外再挑的模型 */
  const [compare, setCompare] = useState<Picked[]>([]);
  const [exportOpen, setExportOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const msgsRef = useRef<ChatMsg[]>([]);
  msgsRef.current = messages;

  // 空闲时预加载 Markdown 渲染模块（第一条回答出来时就不用再等它下载）
  useEffect(() => {
    const go = () => void loadMarkdown().catch(() => {});
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (initialId) go();
    else if (w.requestIdleCallback) w.requestIdleCallback(go);
    else setTimeout(go, 1500);
  }, [initialId]);

  // 加载已有对话：优先用本页缓存（立刻显示），再用服务端随页面一起发来的数据，最后才单独请求
  useEffect(() => {
    if (!initialId) return;
    let alive = true;
    const apply = (c: Conversation) => {
      setMessages(c.messages);
      setTitle(c.title);
      setCreatedAt(c.createdAt);
      setSystem(c.system || "");
      if (c.temperature != null) setTemperature(c.temperature);
      if (c.model) setChatModel((p) => p || { model: c.model! });
      setLoaded(true);
    };
    const cached = peekConv(initialId);
    if (cached) apply(cached);
    const fromServer = takeInitial(initial);
    const p = fromServer
      ? Promise.resolve(fromServer).then((c) => {
          if (c) putConv(c);
          return c;
        })
      : fetchConv(initialId);
    p.then((c) => {
      if (!alive) return;
      if (!c) {
        if (!cached) {
          setNotFound(true);
          setLoaded(true);
        }
        return;
      }
      if (!cached || (c.updatedAt || 0) > (cached.updatedAt || 0)) apply(c);
    }).catch(() => {
      if (!alive || cached) return;
      setNotFound(true);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId]);

  // 默认模型
  useEffect(() => {
    if (!ready) return;
    setTemperature((t) => (initialId ? t : settings.temperature));
    setChatModel((p) => {
      if (p && catalog.some((g) => g.models.some((m) => m.id === p.model))) return p;
      return firstModel(catalog, false, settings.defaultModel) || p;
    });
    setImageModel((p) => p || firstModel(catalog, true, settings.defaultImageModel));
  }, [ready, catalog, settings.defaultModel, settings.defaultImageModel, settings.temperature, initialId]);

  // 新对话的空白页：空闲时在后台读一次最新的预设（不挡首屏）。
  // 页面可能是另一个实例渲染的，它缓存里的预设可能还没包含刚在设置页加的那条。
  const { revalidatePresets } = app;
  const emptyPage = !initialId && !messages.length;
  useEffect(() => {
    if (!emptyPage) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => void revalidatePresets());
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(() => void revalidatePresets(), 300);
    return () => clearTimeout(t);
  }, [emptyPage, revalidatePresets]);

  // 自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const setMode = useCallback(
    (m: "chat" | "image") => {
      setModeState(m);
      if (m === "image" && !imageModel) setImageModel(firstModel(catalog, true, settings.defaultImageModel));
    },
    [imageModel, catalog, settings.defaultImageModel],
  );

  const current = mode === "image" ? imageModel : chatModel;
  const hasModels = catalog.some((g) => !g.disabled && g.models.length);
  const showIntro = ready && loaded && !messages.length && hasModels && !seen("chat-intro");

  // ===== 保存对话 =====
  const save = useCallback(
    async (msgs: ChatMsg[], id: string, t: string) => {
      const conv: Conversation = {
        id,
        title: t,
        hasImage: msgs.some((m) => m.mode === "image"),
        model: chatModel?.model,
        system: system || undefined,
        temperature,
        messages: msgs.filter((m) => !m.pending),
        createdAt,
        updatedAt: Date.now(),
      };
      // 先更新左栏和本页缓存（乐观更新），再写服务端
      putConv(conv);
      app.setConversations((list) => {
        const meta = { id, title: t, hasImage: conv.hasImage, model: conv.model, createdAt, updatedAt: conv.updatedAt };
        return [meta, ...list.filter((c) => c.id !== id)];
      });
      try {
        await api(`/api/conversations/${id}`, { method: "PUT", body: conv });
      } catch (e) {
        toast("对话保存失败：" + (e as Error).message, "err");
      }
    },
    [chatModel, system, temperature, createdAt, app],
  );

  function ensureConv(firstText: string) {
    let id = convId;
    let t = title;
    if (!id) {
      id = uid();
      setConvId(id);
      window.history.replaceState(null, "", `/c/${id}`);
    }
    if (!t) {
      t = firstText.replace(/\s+/g, " ").trim().slice(0, 30) || "新对话";
      setTitle(t);
    }
    return { id, t };
  }

  function patch(id: string, p: Partial<ChatMsg> | ((m: ChatMsg) => Partial<ChatMsg>)) {
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...(typeof p === "function" ? p(m) : p) } : m)));
  }

  // ===== 对话 =====
  /**
   * 发一轮对话。models 不传时：当前模型 + 并排选中的模型。
   * 多个模型时各自独立流式输出，同一组回答带同一个 group；第一个默认「选用」，其余 alt=true（不进后续上下文）。
   */
  async function runChat(history: ChatMsg[], conv: { id: string; t: string }, models?: Picked[]) {
    if (!chatModel) return toast(copy.chat.noModel, "err");
    const same = (a: Picked, b: Picked) => a.model === b.model && (a.channelId || "") === (b.channelId || "");
    const list = (models || [chatModel, ...compare]).filter((x, i, arr) => arr.findIndex((y) => same(x, y)) === i).slice(0, 4);
    const group = list.length > 1 ? uid() : undefined;
    const assistants: ChatMsg[] = list.map((pk, i) => ({
      id: uid(),
      role: "assistant",
      text: "",
      model: pk.model,
      mode: "chat",
      pending: true,
      createdAt: Date.now(),
      ...(group ? { group, alt: i > 0 } : {}),
    }));
    setMessages([...history, ...assistants]);
    setStreaming(true);
    stickRef.current = true;
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await Promise.all(assistants.map((a, i) => streamOne(a.id, list[i], history, ac.signal, group)));
    } finally {
      setStreaming(false);
      abortRef.current = null;
      setTimeout(() => void save(msgsRef.current, conv.id, conv.t), 0);
    }
  }

  async function streamOne(aid: string, pk: Picked, history: ChatMsg[], signal: AbortSignal, group?: string) {
    let text = "";
    let reasoning = "";
    let dirty = false;
    const flush = () => {
      if (!dirty) return;
      dirty = false;
      patch(aid, { text, reasoning: reasoning || undefined });
    };
    const timer = setInterval(flush, 50);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: pk.model, channelId: pk.channelId, messages: history, system, temperature }),
        signal,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        notifyDbDown(res.status, j);
        throw new Error(j.error || `请求失败（${res.status}）`);
      }
      await readEvents(res, (ev, data) => {
        const d = data as Record<string, unknown>;
        if (ev === "text") {
          text += d.t as string;
          dirty = true;
        } else if (ev === "reasoning") {
          reasoning += d.t as string;
          dirty = true;
        } else if (ev === "notice") {
          const n: ChatMsg = { id: uid(), role: "notice", text: d.text as string, createdAt: Date.now() };
          setMessages((list) => {
            // 并排时把提示放在整组前面，不打断并排
            const i = group ? list.findIndex((m) => m.group === group) : list.findIndex((m) => m.id === aid);
            return i < 0 ? [...list, n] : [...list.slice(0, i), n, ...list.slice(i)];
          });
        } else if (ev === "meta") patch(aid, { channel: d.channel as string });
        else if (ev === "usage") patch(aid, { usage: d as unknown as ChatMsg["usage"] });
        else if (ev === "done") patch(aid, { latencyMs: d.latencyMs as number });
        else if (ev === "error") patch(aid, { error: d as unknown as ChatMsg["error"] });
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") patch(aid, { error: { title: "请求失败", message: (e as Error).message } });
      else if (!text) patch(aid, { text: `*${copy.chat.stopped}*` });
    } finally {
      clearInterval(timer);
      dirty = true;
      flush();
      patch(aid, { pending: false });
    }
  }

  /** 并排回答里选一个作为后续上下文 */
  function choose(group: string, id: string) {
    if (streaming) return;
    const next = msgsRef.current.map((m) => (m.group === group ? { ...m, alt: m.id !== id } : m));
    setMessages(next);
    void save(next, convId, title);
  }

  function applyPreset(p: Preset) {
    setSystem(p.system);
    if (p.temperature != null) setTemperature(p.temperature);
    toast(`已套用预设「${p.name}」`, "ok");
  }

  // ===== 生图 =====
  async function runImage(prompt: string, opts: ImageOpts, history: ChatMsg[], conv: { id: string; t: string }) {
    const picked = imageModel || firstModel(catalog, true, settings.defaultImageModel);
    if (!picked) return toast("还没有可用的生图模型，去渠道页启用一个吧", "err");
    if (!seen("first-image")) setFirstImageTip(true);
    const aid = uid();
    const assistant: ChatMsg = {
      id: aid,
      role: "assistant",
      text: "",
      mode: "image",
      model: picked.model,
      pending: true,
      imageMeta: { prompt, size: opts.size, n: opts.n, quality: opts.quality || undefined, refs: opts.refs },
      createdAt: Date.now(),
    };
    setMessages([...history, assistant]);
    setStreaming(true);
    stickRef.current = true;
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await api<{
        images?: string[];
        channel?: string;
        latencyMs?: number;
        notices?: { text: string }[];
        revisedPrompt?: string;
        error?: ChatMsg["error"];
      }>("/api/images", {
        body: { model: picked.model, channelId: picked.channelId, prompt, size: opts.size, n: opts.n, quality: opts.quality || undefined, refs: opts.refs, convId: conv.id },
        signal: ac.signal,
      });
      const notices: ChatMsg[] = (r.notices || []).map((n) => ({ id: uid(), role: "notice", text: n.text, createdAt: Date.now() }));
      setMessages((list) => {
        const i = list.findIndex((m) => m.id === aid);
        const updated = { ...list[i], images: r.images, channel: r.channel, latencyMs: r.latencyMs, error: r.error, text: r.revisedPrompt || "" };
        return [...list.slice(0, i), ...notices, updated, ...list.slice(i + 1)];
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") patch(aid, { error: { title: "生图失败", message: (e as Error).message } });
      else patch(aid, { error: { title: copy.chat.stopped, message: "上游可能仍在生成，但结果不会保存。" } });
    } finally {
      patch(aid, { pending: false });
      setStreaming(false);
      abortRef.current = null;
      setTimeout(() => void save(msgsRef.current, conv.id, conv.t), 0);
    }
  }

  // ===== 发送 =====
  function send(override?: { text?: string; mode?: "chat" | "image" }) {
    if (streaming) return;
    let text = (override?.text ?? input).trim();
    if (!text) return;
    let m = override?.mode ?? mode;
    if (/^\/(图|img|image)\s*/i.test(text)) {
      text = text.replace(/^\/(图|img|image)\s*/i, "").trim();
      m = "image";
      if (!text) return toast("请在 /图 后面写上画面描述");
    }
    if (showIntro) markTip("chat-intro");
    const conv = ensureConv(text);
    const base = msgsRef.current;
    if (m === "image") {
      const opts = { ...imageOpts };
      const user: ChatMsg = { id: uid(), role: "user", text, mode: "image", images: opts.refs.length ? opts.refs : undefined, createdAt: Date.now() };
      setInput("");
      setImageOpts((o) => ({ ...o, refs: [] }));
      void runImage(text, opts, [...base, user], conv);
    } else {
      const user: ChatMsg = { id: uid(), role: "user", text, mode: "chat", images: attachments.length ? attachments : undefined, createdAt: Date.now() };
      setInput("");
      setAttachments([]);
      void runChat([...base, user], conv);
    }
  }

  function regenerate() {
    const list = msgsRef.current;
    let i = list.length - 1;
    while (i >= 0 && list[i].role !== "user") i--;
    if (i < 0) return;
    // 上一轮是并排回答：用同一组模型重来；否则只用当前模型
    const last = list.slice(i + 1).filter((m) => m.role === "assistant");
    const models: Picked[] | undefined =
      last.length > 1 && last[0].group ? last.map((m) => ({ model: m.model || "" })).filter((x) => x.model) : chatModel ? [chatModel] : undefined;
    void runChat(list.slice(0, i + 1), { id: convId, t: title }, models);
  }

  function regenImage(m: ChatMsg) {
    if (!m.imageMeta || streaming) return;
    const meta = m.imageMeta;
    void runImage(
      meta.prompt,
      { size: meta.size || "1024x1024", n: meta.n || 1, quality: (meta.quality as ImageOpts["quality"]) || "", refs: meta.refs || [] },
      msgsRef.current,
      { id: convId, t: title },
    );
  }

  function editImage(url: string) {
    setMode("image");
    setImageOpts((o) => ({ ...o, refs: [url] }));
    textRef.current?.focus();
  }

  async function healthCheck() {
    const list = channels.filter((c) => c.enabled);
    const push = (text: string) => setMessages((l) => [...l, { id: uid(), role: "notice", text, createdAt: Date.now() }]);
    if (!list.length) return push(fill(copy.chat.healthNone, { name }));
    push(copy.chat.healthStart);
    const results = await Promise.all(
      list.map(async (c) => {
        try {
          const r = await api<{ ok: boolean; latencyMs?: number; message?: string }>(`/api/channels/${c.id}/test`, { body: {} });
          return { name: c.name, ...r };
        } catch (e) {
          return { name: c.name, ok: false, message: (e as Error).message };
        }
      }),
    );
    const ok = results.filter((r) => r.ok).length;
    const detail = results.map((r) => (r.ok ? `${r.name} ${r.latencyMs}ms` : `${r.name} 失败（${(r.message || "").slice(0, 60)}）`)).join("；");
    push(fill(copy.chat.healthDone, { ok, bad: results.length - ok, detail }));
    void app.refresh();
  }

  function suggestion(kind: string, prompt: string) {
    if (kind === "chat") {
      setMode("chat");
      setInput(prompt);
      textRef.current?.focus();
    } else if (kind === "image") {
      setMode("image");
      setInput(prompt);
      textRef.current?.focus();
    } else if (kind === "vision") {
      setMode("chat");
      const v = visionModel();
      if (v && !hasCap(chatModel, "vision")) setChatModel(v);
      setInput("帮我看看这张图里有什么");
      fileRef.current?.click();
    } else if (kind === "health") void healthCheck();
  }

  function hasCap(pk: Picked | undefined, cap: "vision") {
    if (!pk) return false;
    for (const g of catalog) {
      if (pk.channelId && g.channelId !== pk.channelId) continue;
      const m = g.models.find((x) => x.id === pk.model);
      if (m) return m.caps.includes(cap);
    }
    return false;
  }
  function visionModel(): Picked | undefined {
    for (const g of catalog) {
      if (g.disabled) continue;
      const m = g.models.find((x) => x.caps.includes("vision"));
      if (m) return { model: m.id, channelId: g.channelId };
    }
    return undefined;
  }
  // 附了图，但当前（或并排里的）模型没有「识图」标签
  const noVision = mode === "chat" && attachments.length > 0 ? [chatModel, ...compare].filter((x): x is Picked => !!x && !hasCap(x, "vision")) : [];
  const suggestVision = noVision.length ? visionModel() : undefined;
  const visionNotice = noVision.length ? (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warn/10 px-3 py-2 text-xs text-ink/80">
      <IdolAvatar size={18} />
      <span className="min-w-0 flex-1">
        {fill(copy.chat.noVision, { model: noVision.map((x) => x.model).join("、") })}
      </span>
      {suggestVision && !hasCap(chatModel, "vision") && (
        <button className="btn-ghost btn-sm" onClick={() => setChatModel(suggestVision)}>
          换成 {suggestVision.model}
        </button>
      )}
    </div>
  ) : null;

  // 并排回答：相邻、同组的回答合成一行
  const rows = useMemo(() => {
    const out: (ChatMsg | ChatMsg[])[] = [];
    for (const m of messages) {
      const last = out[out.length - 1];
      if (m.role === "assistant" && m.group) {
        if (Array.isArray(last) && last[0].group === m.group) last.push(m);
        else out.push([m]);
      } else out.push(m);
    }
    return out;
  }, [messages]);

  const lastAssistantIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "assistant") return i;
    return -1;
  }, [messages]);

  const firstErrorId = useMemo(() => (seen("first-error") ? null : messages.find((m) => m.error && !m.pending)?.id || null), [messages, seen]);

  if (notFound)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <IdolAvatar size={80} />
        <p className="text-sm text-muted">这个对话找不到了，可能已经被删除。</p>
        <Link href="/" className="btn-primary">
          开始新对话
        </Link>
      </div>
    );

  const ICONS: Record<string, typeof Code2> = { chat: Code2, image: Palette, vision: Eye, health: HeartPulse };

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <header className="z-20 flex items-center gap-2 border-b border-rule bg-ground/85 px-3 py-2 backdrop-blur md:px-6">
        <button className="rounded-lg p-1.5 text-muted hover:bg-hover md:hidden" onClick={() => app.setSidebarOpen(true)} aria-label="打开菜单">
          <Menu size={20} />
        </button>
        <ModelPicker
          catalog={catalog}
          value={current}
          badge={showIntro ? <Num n={1} /> : undefined}
          onChange={(p, isImage) => {
            if (isImage) {
              setImageModel(p);
              setModeState("image");
            } else {
              setChatModel(p);
              setModeState("chat");
            }
          }}
        />
        <div className="ml-auto hidden truncate text-xs text-muted sm:block">{title}</div>
        {convId && messages.length > 0 && (
          <div className="relative ml-auto sm:ml-0">
            <button
              className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink disabled:opacity-40"
              title="导出对话"
              aria-label="导出对话"
              disabled={streaming}
              onClick={() => setExportOpen((v) => !v)}
            >
              <Download size={18} />
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setExportOpen(false)} />
                <div className="card absolute right-0 top-full z-40 mt-1 w-44 p-1.5 shadow-2xl">
                  <div className="px-2 py-1 text-[11px] text-muted">导出这个对话</div>
                  {(
                    [
                      ["md", "Markdown（.md）"],
                      ["json", "JSON（.json）"],
                    ] as const
                  ).map(([f, l]) => (
                    <a
                      key={f}
                      href={`/api/conversations/${convId}/export?format=${f}`}
                      download
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-soft"
                      onClick={() => setTimeout(() => setExportOpen(false), 0)}
                    >
                      <FileDown size={14} /> {l}
                    </a>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </header>

      {/* 消息流 */}
      <div
        ref={scrollRef}
        className="scroll-thin flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 md:px-6">
          {loaded && !messages.length && (
            <div className="pt-2 md:pt-6" data-testid="chat-empty">
              {ready && !hasModels ? (
                <RinneScene
                  mood="guide"
                  size="md"
                  ly={34}
                  priority
                  testId="chat-empty-scene"
                  link={
                    <RinneBubble title="我是棱音，您的专属秘书。">
                      <p className="mb-3">{fill(copy.chat.emptyNoChannel, { name })}</p>
                      <Link href="/channels" className="btn-primary btn-sm">
                        去接入线路
                      </Link>
                    </RinneBubble>
                  }
                />
              ) : (
                <RinneScene
                  mood="welcome"
                  size="md"
                  ly={30}
                  priority
                  testId="chat-empty-scene"
                  link={<RinneBubble>{fill(copy.chat.emptyTitle, { name })}</RinneBubble>}
                >
                  <div className="flex w-full flex-col items-center">
                  {app.presets.length > 0 && (
                    <div className="mb-4 flex w-full max-w-2xl flex-wrap items-center justify-center gap-1.5" data-testid="preset-row">
                      <span className="mr-1 text-xs text-muted">{copy.chat.presetPick}</span>
                      {app.presets.slice(0, 8).map((ps) => (
                        <button
                          key={ps.id}
                          className={`chip ${system === ps.system ? "!border-acc !text-acc-ink" : ""}`}
                          onClick={() => applyPreset(ps)}
                          title={ps.system.slice(0, 120)}
                        >
                          <ScrollText size={12} /> {ps.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="grid w-full max-w-2xl grid-cols-2 gap-2.5">
                    {copy.suggestions.map((s) => {
                      const Icon = ICONS[s.kind];
                      return (
                        <button key={s.title} className="card flex items-start gap-2.5 p-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-md" onClick={() => suggestion(s.kind, s.prompt)}>
                          <span className="grad flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white">
                            <Icon size={16} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">{s.title}</span>
                            <span className="line-clamp-1 text-xs text-muted">{s.prompt || (s.kind === "vision" ? "上传一张图让模型识别" : "挨个测速，看看哪条线路状态好")}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  </div>
                </RinneScene>
              )}
            </div>
          )}

          {rows.map((row) => {
            if (Array.isArray(row)) {
              const isLastGroup = row.some((m) => messages.indexOf(m) === lastAssistantIdx);
              return (
                <div key={row[0].group} className="-mx-1 overflow-x-auto pb-1" data-testid="compare-row">
                  <div className="grid gap-3 px-1" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(250px, 1fr))` }}>
                    {row.map((m) => (
                      <div key={m.id} className={`card min-w-0 p-3 transition ${m.alt ? "opacity-80" : "ring-2 ring-acc/50"}`}>
                        <div className="mb-2 flex items-center justify-end gap-2">
                          {m.alt ? (
                            <button className="btn-ghost btn-sm" disabled={streaming || m.pending} onClick={() => choose(m.group!, m.id)}>
                              选用这个
                            </button>
                          ) : (
                            <span className="pill !m-0 !py-0.5 text-[11px]">
                              <Check size={12} /> 已选用
                            </span>
                          )}
                        </div>
                        <MessageItem
                          m={m}
                          isLast={isLastGroup && !m.alt}
                          streaming={streaming}
                          onRegenerate={!streaming ? regenerate : undefined}
                          firstErrorTip={m.id === firstErrorId}
                          onFirstErrorSeen={() => markTip("first-error")}
                        />
                      </div>
                    ))}
                  </div>
                  {isLastGroup && !streaming && <p className="mt-1.5 px-1 text-[11px] text-muted">{copy.chat.compareHint}</p>}
                </div>
              );
            }
            const m = row;
            const i = messages.indexOf(m);
            return (
              <MessageItem
                key={m.id}
                m={m}
                isLast={i === lastAssistantIdx && i >= messages.length - 2}
                streaming={streaming}
                onRegenerate={!streaming ? regenerate : undefined}
                onEditImage={editImage}
                onRegenImage={!streaming ? () => regenImage(m) : undefined}
                firstErrorTip={m.id === firstErrorId}
                onFirstErrorSeen={() => markTip("first-error")}
              />
            );
          })}

          {firstImageTip && (
            <Coach
              onOk={() => {
                setFirstImageTip(false);
                markTip("first-image");
              }}
            >
              {copy.chat.firstImageTip}
            </Coach>
          )}
        </div>
      </div>

      {/* 输入区 */}
      <div className="mx-auto w-full max-w-3xl px-3 pb-3 md:px-6 md:pb-5">
        {showIntro && (
          <div className="mb-2">
            <Coach onOk={() => markTip("chat-intro")}>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  <b>①</b> 点顶部换模型
                </span>
                <span>
                  <b>②</b> 用这个开关切到生图
                </span>
                <span>
                  <b>③</b> 输入 <code className="rounded bg-white/15 px-1">/图 描述</code> 快速生图
                </span>
              </div>
            </Coach>
          </div>
        )}
        <Composer
          mode={mode}
          setMode={setMode}
          input={input}
          setInput={setInput}
          attachments={attachments}
          setAttachments={setAttachments}
          imageOpts={imageOpts}
          setImageOpts={setImageOpts}
          system={system}
          setSystem={setSystem}
          temperature={temperature}
          setTemperature={setTemperature}
          streaming={streaming}
          onSend={() => send()}
          onStop={() => abortRef.current?.abort()}
          showNums={showIntro}
          fileInputRef={fileRef}
          textRef={textRef}
          presets={app.presets}
          onApplyPreset={applyPreset}
          catalog={catalog}
          primary={chatModel}
          compare={compare}
          setCompare={setCompare}
          visionNotice={visionNotice}
        />
        <p className="mt-1.5 hidden text-center text-[11px] text-muted sm:block">{copy.chat.hint}</p>
      </div>
    </div>
  );
}
