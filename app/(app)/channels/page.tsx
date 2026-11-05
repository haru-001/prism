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
import { RinnePageHead } from "@/components/rinne/RinnePageHead";


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
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
        {channels.length > 0 && (
          <div className="mb-6">
            <RinnePageHead page="channels">
              {fill(copy.channels.say, { n: channels.length, ok: channels.filter((c) => c.enabled && c.status?.ok && !c.autoDisabled).length })}
            </RinnePageHead>
          </div>
        )}
        {!channels.length && (
          <Empty text={copy.channels.empty}>
            <button className="btn-primary" onClick={() => setEditing({ ch: null })}>
              <Plus size={16} /> 接入第一条线路
            </button>
          </Empty>
        )}
        {channels.length > 0 && (
          <div className="card divide-y divide-rule overflow-hidden p-0">
            {channels.map((ch) => {
              const n = new Set([...ch.models, ...Object.keys(ch.mapping || {})]).size;
              const aliases = Object.keys(ch.mapping || {}).length;
              const dim = !ch.enabled || ch.autoDisabled;
              const errMsg = ch.status && !ch.status.ok && !ch.autoDisabled ? ch.status.message : "";
              const modelTip = ch.models.length ? ch.models.join("\n") : "还没有模型";
              return (
                <div key={ch.id} className={`group px-3 py-2.5 sm:px-4 ${dim ? "bg-card/60" : "hover:bg-hover/50"}`}>
                  {/* 一行一个渠道：图标 · 名称和状态 · 地址 · 模型数/优先级 · 开关 · 操作 */}
                  <div className="flex min-w-0 items-center gap-3">
                    <ProviderLogo type={ch.type} size={26} dim={dim} />
                    <div className="flex w-36 shrink-0 flex-col sm:w-44">
                      <b className={`truncate text-sm leading-5 ${dim ? "text-muted" : ""}`} title={ch.name}>
                        {ch.name}
                      </b>
                      <StatusBadge ch={ch} />
                    </div>
                    <a
                      href={href(ch.baseUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hidden min-w-0 flex-1 items-center gap-1 font-mono text-xs text-acc-ink hover:underline md:flex"
                      title={`${ch.baseUrl}\n在新标签页打开（实际请求 ${ch.endpoint}）`}
                    >
                      <span className="truncate">{ch.baseUrl}</span>
                      <ExternalLink size={12} className="shrink-0 opacity-60" />
                    </a>
                    <span className="hidden shrink-0 text-xs whitespace-nowrap text-muted lg:inline" title={modelTip}>
                      {ch.keyHint}
                    </span>
                    <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted md:ml-0" title={modelTip}>
                      {n} 模型{aliases > 0 && ` · ${aliases} 别名`} · P{ch.priority}
                    </span>
                    <div className="shrink-0" title={ch.enabled ? "点击停用" : "点击启用"}>
                      <Toggle on={ch.enabled} onChange={(v) => setEnabled(ch, v)} />
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button className="btn-ghost btn-sm px-1.5" title="获取模型" aria-label="获取模型" onClick={() => setEditing({ ch, fetch: true })}>
                        <CloudDownload size={14} />
                      </button>
                      <button className="btn-ghost btn-sm px-1.5" title="测试" aria-label="测试" onClick={() => test(ch)} disabled={testing[ch.id]}>
                        {testing[ch.id] ? <Loader2 size={14} className="animate-spin" /> : <Gauge size={14} />}
                      </button>
                      <button className="btn-ghost btn-sm px-1.5" title="编辑" aria-label="编辑" onClick={() => setEditing({ ch })}>
                        <Pencil size={14} />
                      </button>
                      <button className="btn-ghost btn-sm px-1.5 text-bad" title="删除" aria-label="删除" onClick={() => remove(ch)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {/* 只有出问题时才多一行提示 */}
                  {errMsg && (
                    <div className="mt-1.5 truncate rounded-md bg-bad/10 px-2 py-1 font-mono text-[11px] text-bad" title={errMsg}>
                      {errMsg}
                    </div>
                  )}
                  {ch.autoDisabled && (
                    <div className="mt-1.5 flex items-center gap-2 rounded-md bg-soft px-2 py-1 text-xs">
                      <IdolAvatar size={18} />
                      <span className="min-w-0 flex-1 truncate">{fill(copy.channels.autoDisabledTip, { n: 3 })}</span>
                      <button className="btn-ghost btn-sm" onClick={() => test(ch)} disabled={testing[ch.id]}>
                        {testing[ch.id] && <Loader2 size={12} className="animate-spin" />} 重新测试
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
