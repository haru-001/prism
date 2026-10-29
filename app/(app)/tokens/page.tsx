"use client";

import { useEffect, useState } from "react";
import { Copy, Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";
import { useApp } from "@/components/AppContext";
import { IdolSay, PageHeader, copyText, toast } from "@/components/ui";
import { api } from "@/lib/client/api";
import { copy } from "@/lib/copy";

const ENDPOINTS = [
  { method: "POST", path: "/v1/chat/completions", desc: "OpenAI 格式对话，支持流式" },
  { method: "POST", path: "/v1/messages", desc: "Claude 格式对话，支持流式" },
  { method: "POST", path: "/v1beta/models/{model}:generateContent", desc: "Gemini 格式对话" },
  { method: "POST", path: "/v1beta/models/{model}:streamGenerateContent", desc: "Gemini 格式流式对话" },
  { method: "POST", path: "/v1/images/generations", desc: "生图（OpenAI 格式）" },
  { method: "GET", path: "/v1/models", desc: "模型列表（OpenAI / Claude 格式）" },
  { method: "GET", path: "/v1beta/models", desc: "模型列表（Gemini 格式）" },
];

function Field({ label, value, display, extra }: { label: string; value: string; display?: string; extra?: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex items-center gap-2 rounded-xl border border-rule bg-soft px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-sm">{display ?? value}</code>
        {extra}
        <button className="chip" onClick={() => copyText(value)} disabled={!value}>
          <Copy size={12} /> 复制
        </button>
      </div>
    </div>
  );
}

export default function TokensPage() {
  const { catalog, flags } = useApp();
  const [origin, setOrigin] = useState("");
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    api<{ token: string }>("/api/token")
      .then((r) => setToken(r.token))
      .catch((e) => toast((e as Error).message, "err"));
  }, []);

  async function reset() {
    if (!confirm(copy.tokens.resetConfirm)) return;
    setBusy(true);
    try {
      const r = await api<{ token: string }>("/api/token", { method: "POST" });
      setToken(r.token);
      setShow(true);
      toast("令牌已重置，旧令牌已失效", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  const masked = token ? `${token.slice(0, 9)}••••••••${token.slice(-4)}` : "读取中…";
  const live = catalog.filter((g) => !g.disabled);
  const sample = live.flatMap((g) => g.models).find((m) => m.caps.includes("chat"))?.id || "gpt-4o";
  const modelCount = new Set(live.flatMap((g) => g.models.map((m) => m.id))).size;
  const curl = `curl ${origin}/v1/chat/completions \\
  -H "Authorization: Bearer ${token || "你的令牌"}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${sample}","messages":[{"role":"user","content":"你好"}],"stream":true}'`;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader title="令牌与接口" sub="给外部客户端用，一个令牌通吃" />
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 md:px-8">
        <IdolSay>{copy.tokens.say}</IdolSay>

        <div className="card space-y-4 p-5">
          <Field label="Base URL" value={origin} />
          <Field
            label="访问令牌"
            value={token}
            display={show ? token : masked}
            extra={
              <>
                <button className="chip" onClick={() => setShow((v) => !v)} disabled={!token}>
                  {show ? <EyeOff size={12} /> : <Eye size={12} />} {show ? "隐藏" : "显示"}
                </button>
                <button className="chip" onClick={reset} disabled={busy || !token}>
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} 重置
                </button>
              </>
            }
          />
          <p className="text-xs leading-relaxed text-muted">
            令牌可以放在 <code className="font-mono">Authorization: Bearer</code>、<code className="font-mono">x-api-key</code>、<code className="font-mono">x-goog-api-key</code> 请求头或 <code className="font-mono">?key=</code> 参数里。
            {flags.envToken && " 环境变量 PRISM_API_TOKEN 里的固定令牌也能用，重置不影响它。"}
          </p>
        </div>

        <div>
          <h2 className="mb-2 font-semibold">客户端怎么填</h2>
          <div className="card divide-y divide-rule text-sm">
            {[
              { name: "OpenAI 兼容客户端", sub: "Cherry Studio、LobeChat、NextChat、沉浸式翻译等", base: `${origin}/v1` },
              { name: "Claude 格式客户端", sub: "填 ANTHROPIC_BASE_URL 的地方", base: origin },
              { name: "Gemini 格式客户端", sub: "自定义 Gemini API 地址的地方", base: origin },
            ].map((c) => (
              <div key={c.name} className="flex flex-wrap items-center gap-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted">{c.sub}</div>
                </div>
                <code className="rounded-lg bg-soft px-2 py-1 font-mono text-xs">{c.base}</code>
                <button className="chip" onClick={() => copyText(c.base)}>
                  <Copy size={12} />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            密钥 / API Key 一律填上面的令牌。模型名用渠道里勾选的名字或别名，当前可用 {modelCount} 个。
          </p>
        </div>

        <div>
          <h2 className="mb-2 font-semibold">接口列表</h2>
          <div className="card divide-y divide-rule">
            {ENDPOINTS.map((e) => (
              <div key={e.path} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className={`w-11 shrink-0 font-mono text-xs font-bold ${e.method === "GET" ? "text-ok" : "text-acc-ink"}`}>{e.method}</span>
                <code className="min-w-0 flex-1 break-all font-mono text-sm">{e.path}</code>
                <span className="text-xs text-muted">{e.desc}</span>
                <button className="chip" onClick={() => copyText(origin + e.path)} aria-label="复制完整地址">
                  <Copy size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center">
            <h2 className="font-semibold">试一下</h2>
            <button className="chip ml-auto" onClick={() => copyText(curl)}>
              <Copy size={12} /> 复制
            </button>
          </div>
          <pre className="scroll-thin overflow-x-auto rounded-2xl bg-[#14121d] p-4 font-mono text-xs leading-relaxed text-[#e6e3ff]">{curl}</pre>
        </div>
      </div>
    </div>
  );
}
