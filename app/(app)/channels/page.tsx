"use client";

import { useState } from "react";
import { CloudDownload, ExternalLink, Gauge, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useApp } from "@/components/AppContext";
import { ChannelEditor } from "@/components/channels/ChannelEditor";
import { ProviderLogo } from "@/components/ProviderCards";
import { Empty, PageHeader, Toggle, toast } from "@/components/ui";
import { IdolAvatar } from "@/components/Logo";
import { api, fmtTime } from "@/lib/client/api";
import { copy, fill } from "@/lib/copy";
import type { PublicChannel } from "@/lib/types";

function href(u: string) {
  const s = u.trim().replace(/#$/, "");
  return /^https?:\/\//i.test(s) ? s : "https://" + s;
}

function StatusBadge({ ch }: { ch: PublicChannel }) {
  let cls = "text-muted";
  let dot = "bg-muted";
  let text = "未测试";
  if (!ch.enabled) text = "已停用";
  else if (ch.autoDisabled) {
    cls = "text-bad";
    dot = "bg-bad";
    text = "超时，已自动停用";
  } else if (ch.status?.ok) {
    cls = "text-ok";
    dot = "bg-ok";
    text = ch.status.latencyMs != null ? fill(copy.channels.testOk, { ms: ch.status.latencyMs }) : "正常";
  } else if (ch.status) {
    cls = "text-bad";
    dot = "bg-bad";
    text = "上次请求失败";
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${cls}`} title={ch.status ? `更新于 ${fmtTime(ch.status.at)}` : undefined}>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {text}
    </span>
  );
}

export default function ChannelsPage() {
  const { channels, refresh, patchBoot } = useApp();
  // 乐观更新：先在本地改列表，界面立刻变化；服务端确认后再在后台刷新一次（拿到模型目录等派生数据）
  const patchChannels = (fn: (list: PublicChannel[]) => PublicChannel[]) => patchBoot((b) => ({ ...b, channels: fn(b.channels) }));
  const bgRefresh = () => void refresh().catch(() => {});
  const [editing, setEditing] = useState<{ ch: PublicChannel | null; fetch?: boolean } | null>(null);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testingAll, setTestingAll] = useState(false);

  async function test(ch: PublicChannel, quiet = false, batch = false) {
    setTesting((t) => ({ ...t, [ch.id]: true }));
    try {
      const r = await api<{ ok: boolean; latencyMs?: number; message?: string; via?: string }>(`/api/channels/${ch.id}/test`, { body: {} });
      if (!quiet) {
        if (r.ok) toast(`${ch.name}：正常 · ${r.latencyMs}ms（${r.via}）`, "ok");
        else toast(`${ch.name}：${r.message}`, "err");
      }
      return r.ok;
    } catch (e) {
      if (!quiet) toast((e as Error).message, "err");
      return false;
    } finally {
      setTesting((t) => ({ ...t, [ch.id]: false }));
      // 全部测速时只在最后刷新一次（原来每条渠道测完都整页刷新一次）
      if (!batch) bgRefresh();
    }
  }

  async function testAll() {
    setTestingAll(true);
    let ok = 0;
    let bad = 0;
    const list = channels.filter((c) => c.enabled);
    await Promise.all(list.map(async (c) => ((await test(c, true, true)) ? ok++ : bad++)));
    setTestingAll(false);
    bgRefresh();
    toast(`检测完成：${ok} 条正常，${bad} 条有问题`, bad ? "err" : "ok");
  }

  async function setEnabled(ch: PublicChannel, enabled: boolean) {
    patchChannels((l) => l.map((c) => (c.id === ch.id ? { ...c, enabled, ...(enabled ? { autoDisabled: false } : {}) } : c)));
    try {
      await api(`/api/channels/${ch.id}`, { method: "PATCH", body: { enabled } });
    } catch (e) {
      toast((e as Error).message, "err");
    }
    bgRefresh();
  }

  async function remove(ch: PublicChannel) {
    if (!confirm(`删除渠道「${ch.name}」？它的 Key 和模型设置会一起删掉。`)) return;
    patchChannels((l) => l.filter((c) => c.id !== ch.id));
    try {
      await api(`/api/channels/${ch.id}`, { method: "DELETE" });
      toast("已删除", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    }
    bgRefresh();
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader
        title="渠道"
        sub="上游线路：同一个模型按优先级走，失败自动切换"
        right={
          <div className="flex gap-2">
            {channels.length > 0 && (
              <button className="btn-ghost hidden sm:inline-flex" onClick={testAll} disabled={testingAll}>
                {testingAll ? <Loader2 size={16} className="animate-spin" /> : <Gauge size={16} />} 全部测速
              </button>
            )}
            <button className="btn-primary" onClick={() => setEditing({ ch: null })}>
              <Plus size={16} /> 添加渠道
            </button>
          </div>
        }
      />
      <div className="mx-auto max-w-4xl space-y-3 px-4 py-6 md:px-8">
        {!channels.length && (
          <Empty text={copy.channels.empty}>
            <button className="btn-primary" onClick={() => setEditing({ ch: null })}>
              <Plus size={16} /> 接入第一条线路
            </button>
          </Empty>
        )}
        {channels.map((ch) => {
          const n = new Set([...ch.models, ...Object.keys(ch.mapping || {})]).size;
          const dim = !ch.enabled || ch.autoDisabled;
          return (
            <div key={ch.id} className={`card p-4 ${dim ? "bg-card/60" : ""}`}>
              <div className="flex flex-wrap items-center gap-2.5">
                <ProviderLogo type={ch.type} size={30} dim={dim} />
                <b className={`truncate ${dim ? "text-muted" : ""}`}>{ch.name}</b>
                <StatusBadge ch={ch} />
                <div className="ml-auto flex items-center gap-2" title={ch.enabled ? "点击停用" : "点击启用"}>
                  <span className="text-xs text-muted">{ch.enabled ? "启用" : "停用"}</span>
                  <Toggle on={ch.enabled} onChange={(v) => setEnabled(ch, v)} />
                </div>
              </div>
              <div className="mt-2 min-w-0">
                <a
                  href={href(ch.baseUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1 break-all font-mono text-sm text-acc-ink hover:underline"
                  title={`在新标签页打开（实际请求 ${ch.endpoint}）`}
                >
                  {ch.baseUrl}
                  <ExternalLink size={13} className="shrink-0" />
                </a>
              </div>
              <div className="mt-1 text-xs text-muted">
                {ch.keyHint} · {n} 个模型 · 优先级 {ch.priority}
                {Object.keys(ch.mapping || {}).length > 0 && <> · {Object.keys(ch.mapping).length} 个别名</>}
              </div>
              {ch.status && !ch.status.ok && !ch.autoDisabled && ch.status.message && (
                <div className="mt-2 break-all rounded-lg bg-bad/10 px-2.5 py-1.5 font-mono text-xs text-bad">{ch.status.message}</div>
              )}
              {ch.autoDisabled && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-soft px-3 py-2 text-xs">
                  <IdolAvatar size={22} />
                  <span className="flex-1">{fill(copy.channels.autoDisabledTip, { n: 3 })}</span>
                  <button className="btn-ghost btn-sm" onClick={() => test(ch)} disabled={testing[ch.id]}>
                    {testing[ch.id] && <Loader2 size={12} className="animate-spin" />} 重新测试
                  </button>
                </div>
              )}
              {ch.models.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {ch.models.slice(0, 8).map((m) => (
                    <span key={m} className="rounded-md bg-soft px-1.5 py-0.5 font-mono text-[11px] text-muted">
                      {m}
                    </span>
                  ))}
                  {ch.models.length > 8 && <span className="px-1 text-[11px] text-muted">+{ch.models.length - 8}</span>}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-primary btn-sm" onClick={() => setEditing({ ch, fetch: true })}>
                  <CloudDownload size={13} /> 获取模型
                </button>
                <button className="btn-ghost btn-sm" onClick={() => test(ch)} disabled={testing[ch.id]}>
                  {testing[ch.id] ? <Loader2 size={13} className="animate-spin" /> : <Gauge size={13} />} 测试
                </button>
                <button className="btn-ghost btn-sm" onClick={() => setEditing({ ch })}>
                  <Pencil size={13} /> 编辑
                </button>
                <button className="btn-danger btn-sm ml-auto" onClick={() => remove(ch)}>
                  <Trash2 size={13} /> 删除
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <ChannelEditor
        open={!!editing}
        channel={editing?.ch || null}
        autoFetch={editing?.fetch}
        onClose={(changed, saved) => {
          setEditing(null);
          if (saved) patchChannels((l) => (l.some((c) => c.id === saved.id) ? l.map((c) => (c.id === saved.id ? saved : c)) : [...l, saved]));
          if (changed) bgRefresh();
        }}
      />
    </div>
  );
}
