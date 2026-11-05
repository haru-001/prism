"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, BookKey, Images, MessageSquarePlus, ScrollText, Search, Settings, Trash2, Waypoints, X } from "lucide-react";
import { Brand, IdolAvatar } from "./Logo";
import { useApp } from "./AppContext";
import { api } from "@/lib/client/api";
import { dropConv, prefetchConv } from "@/lib/client/convCache";
import { copy, fill } from "@/lib/copy";
import type { ConversationMeta } from "@/lib/types";

const NAV = [
  { href: "/gallery", label: "图库", icon: Images },
  { href: "/channels", label: "渠道", icon: Waypoints },
  { href: "/usage", label: "用量", icon: BarChart3 },
  { href: "/tokens", label: "令牌与接口", icon: BookKey },
  { href: "/logs", label: "请求日志", icon: ScrollText },
  { href: "/settings", label: "设置", icon: Settings },
];

function groupOf(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "今天";
  if (now.getTime() - ts < 7 * 86400000) return "前 7 天";
  return "更早";
}

export function Sidebar() {
  const { setConversations, channels, sidebarOpen, setSidebarOpen } = useApp();
  const [q, setQ] = useState("");
  const pathname = usePathname();
  const router = useRouter();

  const enabled = channels.filter((c) => c.enabled);
  const resting = enabled.filter((c) => c.autoDisabled).length;
  const online = enabled.length - resting;
  const status = !enabled.length
    ? copy.status.none
    : resting
      ? fill(copy.status.someResting, { n: online, m: resting })
      : fill(copy.status.allGood, { n: online });

  async function remove(id: string) {
    if (!confirm("删除这个对话？")) return;
    setConversations((l) => l.filter((c) => c.id !== id));
    dropConv(id);
    if (pathname === `/c/${id}`) router.push("/");
    await api(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => {});
  }

  const close = () => setSidebarOpen(false);

  return (
    <>
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={close} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col border-r border-rule bg-side transition-transform md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <Link href="/" onClick={close}>
            <Brand />
          </Link>
          <button className="rounded-lg p-1 text-muted hover:bg-hover md:hidden" onClick={close} aria-label="收起">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-2 px-3 pt-2">
          <button
            className="btn-primary w-full"
            onClick={() => {
              close();
              router.push("/?new=" + Date.now());
            }}
          >
            <MessageSquarePlus size={16} /> 新对话
          </button>
          <label className="flex items-center gap-2 rounded-xl border border-rule bg-card px-3 py-1.5">
            <Search size={14} className="text-muted" />
            <input className="w-full bg-transparent text-sm outline-none placeholder:text-muted" placeholder="搜索对话" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        <nav className="scroll-thin mt-2 flex-1 overflow-y-auto px-2">
          <Suspense fallback={<ListSkeleton />}>
            <ConvList q={q} pathname={pathname} onPick={close} onRemove={remove} />
          </Suspense>
        </nav>
        <div className="space-y-0.5 border-t border-rule px-2 py-2">
          {NAV.map((n) => {
            const Icon = n.icon;
            const on = pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} onClick={close} className={`navitem ${on ? "navitem-on" : ""}`}>
                <Icon size={16} className="text-muted" /> {n.label}
              </Link>
            );
          })}
        </div>
        <Link href="/channels" onClick={close} className="flex items-center gap-2.5 border-t border-rule px-4 py-3 text-xs text-muted hover:text-ink">
          <IdolAvatar size={24} />
          <span className={`h-2 w-2 rounded-full ${!enabled.length ? "bg-muted" : resting ? "bg-warn" : "bg-ok"}`} />
          <span className="truncate">{status}</span>
        </Link>
      </aside>
    </>
  );
}

const PAGE = 60;

function ListSkeleton() {
  return (
    <div className="space-y-1.5 px-2 pt-2" aria-hidden>
      {[70, 55, 80, 62, 48].map((w, i) => (
        <div key={i} className="h-7 animate-pulse rounded-xl bg-hover" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

/** 会话列表：首屏随页面流式渲染；条目多时先渲染前 60 条，滚到底再接着显示 */
function ConvList(props: { q: string; pathname: string; onPick: () => void; onRemove: (id: string) => void }) {
  // 「今天 / 前 7 天」要按浏览器的时区分组，服务端不知道时区，所以列表在浏览器里渲染（数据已随页面到达，不用再请求）
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <ConvListInner {...props} /> : <ListSkeleton />;
}

function ConvListInner({ q, pathname, onPick, onRemove }: { q: string; pathname: string; onPick: () => void; onRemove: (id: string) => void }) {
  const { conversations, conversationsLoaded, convPromise } = useApp();
  const all = conversationsLoaded || !convPromise ? conversations : use(convPromise);
  const [limit, setLimit] = useState(PAGE);
  const more = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k ? all.filter((c) => c.title.toLowerCase().includes(k)) : all;
  }, [all, q]);
  const shown = q.trim() ? filtered : filtered.slice(0, limit);

  const groups = useMemo(() => {
    const out: { name: string; items: ConversationMeta[] }[] = [];
    for (const c of shown) {
      const g = groupOf(c.updatedAt);
      let grp = out.find((x) => x.name === g);
      if (!grp) out.push((grp = { name: g, items: [] }));
      grp.items.push(c);
    }
    return out;
  }, [shown]);

  useEffect(() => {
    const el = more.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setLimit((l) => l + PAGE));
    io.observe(el);
    return () => io.disconnect();
  }, [shown.length]);

  // 鼠标移上去（手机上按下时）就预取对话内容和页面
  const warm = (id: string) => {
    prefetchConv(id);
    router.prefetch(`/c/${id}`);
  };

  return (
    <>
      {groups.map((g) => (
        <div key={g.name} className="mb-2">
          <div className="px-2 py-1.5 text-[11px] font-semibold text-muted">{g.name}</div>
          {g.items.map((c) => {
            const on = pathname === `/c/${c.id}`;
            return (
              <div key={c.id} className={`group flex items-center rounded-xl ${on ? "bg-card shadow-sm ring-1 ring-rule" : "hover:bg-hover"}`}>
                <Link
                  href={`/c/${c.id}`}
                  prefetch={false}
                  onClick={onPick}
                  onPointerEnter={() => warm(c.id)}
                  onPointerDown={() => warm(c.id)}
                  onFocus={() => warm(c.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-sm"
                >
                  <span className="truncate">{c.title}</span>
                  {c.hasImage && <span className="tag-image shrink-0">图</span>}
                </Link>
                <button
                  className="mr-1 hidden rounded-lg p-1 text-muted hover:text-bad group-hover:block"
                  onClick={() => onRemove(c.id)}
                  aria-label="删除对话"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      ))}
      {!q.trim() && filtered.length > shown.length && <div ref={more} className="h-6" />}
      {!groups.length && <p className="px-3 py-6 text-center text-xs text-muted">{q ? "没找到相关对话" : "还没有对话"}</p>}
    </>
  );
}
