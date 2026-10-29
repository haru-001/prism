"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Code2, Eye, HeartPulse, Menu, Palette } from "lucide-react";
import type { ChatMsg, Conversation, ModelGroup } from "@/lib/types";
import { api, readEvents, uid } from "@/lib/client/api";
import { copy, fill } from "@/lib/copy";
import { useApp } from "../AppContext";
import { IdolAvatar } from "../Logo";
import { toast } from "../ui";
import { ModelPicker, type Picked } from "./ModelPicker";
import { Composer, type ImageOpts } from "./Composer";
import { Coach, MessageItem } from "./MessageItem";

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

export function ChatView({ id: initialId }: { id?: string }) {
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

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const msgsRef = useRef<ChatMsg[]>([]);
  msgsRef.current = messages;

  // 加载已有对话
  useEffect(() => {
    if (!initialId) return;
    api<{ conversation: Conversation }>(`/api/conversations/${initialId}`)
      .then(({ conversation: c }) => {
        setMessages(c.messages);
        setTitle(c.title);
        setCreatedAt(c.createdAt);
        setSystem(c.system || "");
        if (c.temperature != null) setTemperature(c.temperature);
        if (c.model) setChatModel((p) => p || { model: c.model! });
        setLoaded(true);
      })
      .catch(() => {
        setNotFound(true);
        setLoaded(true);
      });
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
      try {
        await api(`/api/conversations/${id}`, { method: "PUT", body: conv });
        app.setConversations((list) => {
          const meta = { id, title: t, hasImage: conv.hasImage, model: conv.model, createdAt, updatedAt: Date.now() };
          return [meta, ...list.filter((c) => c.id !== id)];
        });
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
  async function runChat(history: ChatMsg[], conv: { id: string; t: string }) {
    if (!chatModel) return toast(copy.chat.noModel, "err");
    const aid = uid();
    const assistant: ChatMsg = { id: aid, role: "assistant", text: "", model: chatModel.model, mode: "chat", pending: true, createdAt: Date.now() };
    setMessages([...history, assistant]);
    setStreaming(true);
    stickRef.current = true;
    const ac = new AbortController();
    abortRef.current = ac;
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
        body: JSON.stringify({ model: chatModel.model, channelId: chatModel.channelId, messages: history, system, temperature }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
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
            const i = list.findIndex((m) => m.id === aid);
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
      setStreaming(false);
      abortRef.current = null;
      setTimeout(() => void save(msgsRef.current, conv.id, conv.t), 0);
    }
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
      if (!text) return toast("在 /图 后面写上画面描述吧～");
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
    void runChat(list.slice(0, i + 1), { id: convId, t: title });
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
      setInput("帮我看看这张图里有什么");
      fileRef.current?.click();
    } else if (kind === "health") void healthCheck();
  }

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
            <div className="flex flex-col items-center pt-6 text-center md:pt-12">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/img/welcome.jpg" alt="棱音" className="mb-5 h-40 w-40 rounded-[28px] object-cover shadow-lg ring-4 ring-white/60 dark:ring-white/5 md:h-48 md:w-48" />
              {ready && !hasModels ? (
                <>
                  <h2 className="mb-2 text-xl font-bold">嗨，我是棱音！</h2>
                  <p className="mb-5 max-w-sm text-sm text-muted">{fill(copy.chat.emptyNoChannel, { name })}</p>
                  <Link href="/channels" className="btn-primary">
                    去接入线路
                  </Link>
                </>
              ) : (
                <>
                  <h2 className="mb-6 text-xl font-bold md:text-2xl">{fill(copy.chat.emptyTitle, { name })}</h2>
                  <div className="grid w-full max-w-xl grid-cols-2 gap-2.5">
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
                </>
              )}
            </div>
          )}

          {messages.map((m, i) => (
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
          ))}

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
        />
        <p className="mt-1.5 hidden text-center text-[11px] text-muted sm:block">{copy.chat.hint}</p>
      </div>
    </div>
  );
}
