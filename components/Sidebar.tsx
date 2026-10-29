"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { BookKey, Images, MessageSquarePlus, ScrollText, Search, Settings, Trash2, Waypoints, X } from "lucide-react";
import { Brand, IdolAvatar } from "./Logo";
import { useApp } from "./AppContext";
import { api } from "@/lib/client/api";
import { copy, fill } from "@/lib/copy";
import type { ConversationMeta } from "@/lib/types";

const NAV = [
  { href: "/gallery", label: "图库", icon: Images },
  { href: "/channels", label: "渠道", icon: Waypoints },
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
  const { conversations, setConversations, channels, sidebarOpen, setSidebarOpen } = useApp();
  const [q, setQ] = useState("");
  const pathname = usePathname();
  const router = useRouter();

  const groups = useMemo(() => {
    const list = conversations.filter((c) => !q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase()));
    const out: { name: string; items: ConversationMeta[] }[] = [];
    for (const c of list) {
      const g = groupOf(c.updatedAt);
      let grp = out.find((x) => x.name === g);
      if (!grp) out.push((grp = { name: g, items: [] }));
      grp.items.push(c);
    }
    return out;
  }, [conversations, q]);

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
    await api(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => {});
    if (pathname === `/c/${id}`) router.push("/");
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
          {groups.map((g) => (
            <div key={g.name} className="mb-2">
              <div className="px-2 py-1.5 text-[11px] font-semibold text-muted">{g.name}</div>
              {g.items.map((c) => {
                const on = pathname === `/c/${c.id}`;
                return (
                  <div key={c.id} className={`group flex items-center rounded-xl ${on ? "bg-card shadow-sm ring-1 ring-rule" : "hover:bg-hover"}`}>
                    <Link href={`/c/${c.id}`} onClick={close} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-sm">
                      <span className="truncate">{c.title}</span>
                      {c.hasImage && <span className="tag-image shrink-0">图</span>}
                    </Link>
                    <button
                      className="mr-1 hidden rounded-lg p-1 text-muted hover:text-bad group-hover:block"
                      onClick={() => remove(c.id)}
                      aria-label="删除对话"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
          {!groups.length && <p className="px-3 py-6 text-center text-xs text-muted">{q ? "没找到相关对话" : "还没有对话，开始第一场吧～"}</p>}
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
