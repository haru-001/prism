"use client";

import { useEffect, useState } from "react";
import { Copy, Loader2, Play } from "lucide-react";
import { api } from "@/lib/client/api";
import { copyText, toast } from "./ui";
import type { LogDetail } from "@/lib/types";

// 同一条详情打开过就缓存，收起再展开不重新请求
const cache = new Map<string, LogDetail>();

function pretty(body: string) {
  if (!body) return "";
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function Block({ title, text, max = 60000 }: { title: string; text: string; max?: number }) {
  const shown = text.length > max ? text.slice(0, max) + "\n…" : text;
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold text-ink/80">{title}</span>
        {text && (
          <button className="inline-flex items-center gap-1 text-muted hover:text-ink" onClick={() => copyText(text)}>
            <Copy size={11} /> 复制
          </button>
        )}
      </div>
      <pre className="scroll-thin max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-rule bg-card p-2 font-mono text-[11.5px] leading-relaxed">
        {shown || "（空）"}
      </pre>
    </div>
  );
}

interface ReplayResult {
  status: number;
  contentType: string;
  body: string;
  ms: number;
}

export default function LogDetailView({ id, onReplayed }: { id: string; onReplayed?: () => void }) {
  const [d, setD] = useState<LogDetail | null>(cache.get(id) || null);
  const [err, setErr] = useState("");
  const [replaying, setReplaying] = useState(false);
  const [result, setResult] = useState<ReplayResult | null>(null);

  useEffect(() => {
    if (cache.has(id)) return;
    let off = false;
    api<{ detail: LogDetail }>(`/api/logs/${id}`)
      .then((r) => {
        cache.set(id, r.detail);
        if (!off) setD(r.detail);
      })
      .catch((e) => !off && setErr((e as Error).message));
    return () => {
      off = true;
    };
  }, [id]);

  async function replay() {
    if (replaying) return;
    setReplaying(true);
    setResult(null);
    try {
      const r = await api<{ result: ReplayResult }>(`/api/logs/${id}/replay`, { method: "POST" });
      setResult(r.result);
      toast(r.result.status < 400 ? `重放完成（${r.result.status}），新的一条在日志最上面` : `重放了，但还是失败（${r.result.status}）`, r.result.status < 400 ? "ok" : "err");
      onReplayed?.();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setReplaying(false);
    }
  }

  if (err) return <p className="text-muted">{err}</p>;
  if (!d)
    return (
      <div className="space-y-2">
        <div className="shimmer h-4 w-48 rounded" />
        <div className="shimmer h-24 rounded-lg" />
      </div>
    );

  const reqHead = `${d.request.method} ${d.request.path}\n` + Object.entries(d.request.headers).map(([k, v]) => `${k}: ${v}`).join("\n");
  const resHead = `HTTP ${d.response.status}\n` + Object.entries(d.response.headers).map(([k, v]) => `${k}: ${v}`).join("\n");

  return (
    <div className="space-y-3" data-testid="log-detail">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary btn-sm" onClick={() => void replay()} disabled={replaying || d.truncated} title={d.truncated ? "请求内容被截断过，没法原样重放" : "用同样的请求再发一次"}>
          {replaying ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} {replaying ? "重放中…" : "一键重放"}
        </button>
        <span className="text-muted">
          {d.truncated ? "这条请求太大被截断了（或图片被省略），只能看不能重放。" : "密钥、令牌这类敏感信息已打码；重放会重新走一遍线路选择，并记一条新日志。"}
        </span>
      </div>
      {result && (
        <div className="rounded-lg border border-acc/40 bg-acc/5 p-2">
          <div className="mb-1 font-semibold">
            重放结果：HTTP {result.status} · {result.ms} ms
          </div>
          <pre className="scroll-thin max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[11.5px]">{pretty(result.body)}</pre>
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <Block title="请求头" text={reqHead} />
          <Block title="请求体" text={pretty(d.request.body)} />
        </div>
        <div className="space-y-2">
          <Block title="响应头" text={resHead} />
          <Block title="响应体" text={pretty(d.response.body)} />
        </div>
      </div>
    </div>
  );
}
