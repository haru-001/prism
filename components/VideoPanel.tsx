"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ExternalLink, KeyRound, Loader2, PlugZap, Trash2, XCircle } from "lucide-react";
import { api } from "@/lib/client/api";
import { toast } from "@/components/ui";
import { IdolAvatar } from "@/components/Logo";
import { HF_PRESETS, VIDEO_MODES, VIDEO_PROVIDERS, isSpaceName, isToolName, type VideoMode, type VideoProvider } from "@/lib/video";

interface Cfg {
  keys: Partial<Record<VideoProvider, { hint: string; addedAt: number; test?: { ok: boolean; message: string; at: number } }>>;
  provider: VideoProvider;
  hfSpace: Record<VideoMode, string>;
}

const KEY_INFO: Record<VideoProvider, { label: string; placeholder: string; where: string; whereUrl: string }> = {
  hf: { label: "Hugging Face 令牌", placeholder: "hf_…", where: "huggingface.co/settings/tokens", whereUrl: "https://huggingface.co/settings/tokens" },
  zhipu: { label: "智谱 API Key", placeholder: "从智谱控制台复制的 API Key", where: "bigmodel.cn → API Key", whereUrl: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys" },
};

function ProviderCard({ p, cfg, onCfg }: { p: (typeof VIDEO_PROVIDERS)[number]; cfg: Cfg; onCfg: (c: Cfg) => void }) {
  const info = KEY_INFO[p.id];
  const rec = cfg.keys[p.id];
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "test" | "del">("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(rec?.test ? { ok: rec.test.ok, message: rec.test.message } : null);

  async function saveKey() {
    setBusy("save");
    try {
      const r = await api<{ config: Cfg }>("/api/video/config", { body: { provider: p.id, key } });
      onCfg(r.config);
      setKey("");
      setResult(null);
      toast("Key 已加密保存，我顺手测一下连接。", "ok");
      await test();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  }
  async function test() {
    setBusy("test");
    try {
      const r = await api<{ ok: boolean; message: string; config?: Cfg }>("/api/video/test", { body: { provider: p.id } });
      setResult({ ok: r.ok, message: r.message });
      if (r.config) onCfg(r.config);
      toast(r.ok ? "连接正常" : "连接没通过，原因写在卡片里", r.ok ? "ok" : "err");
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setBusy("");
    }
  }
  async function del() {
    if (!confirm(`删除已保存的${info.label}？删除后这个服务就不能生成视频了。`)) return;
    setBusy("del");
    try {
      const r = await api<{ config: Cfg }>(`/api/video/config?provider=${p.id}`, { method: "DELETE" });
      onCfg(r.config);
      setResult(null);
      toast("已删除", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="rounded-xl border border-rule p-3.5" data-testid={`video-provider-${p.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm">{p.name}</b>
        <span className="rounded-full bg-ok/10 px-2 py-0.5 text-[11px] text-ok">{p.free}</span>
        <span className="text-[11px] text-muted">支持：{p.modes.map((m) => VIDEO_MODES.find((x) => x.id === m)!.name).join(" / ")}</span>
      </div>
      {rec ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm">
          <KeyRound size={14} className="text-muted" />
          <code className="rounded bg-soft px-1.5 py-0.5 text-xs" data-testid={`video-key-${p.id}`}>
            {rec.hint}
          </code>
          <button className="btn-ghost btn-sm" onClick={test} disabled={!!busy} data-testid={`video-test-${p.id}`}>
            {busy === "test" ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />} 测试连接
          </button>
          <button className="btn-ghost btn-sm text-bad" onClick={del} disabled={!!busy}>
            <Trash2 size={13} /> 删除
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">还没有添加。</p>
      )}
      <div className="mt-2.5 flex gap-2">
        <input
          className="input"
          type="password"
          autoComplete="off"
          placeholder={rec ? `换一个新的${info.label}` : info.placeholder}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          data-testid={`video-key-input-${p.id}`}
        />
        <button className="btn-primary shrink-0" disabled={!key.trim() || !!busy} onClick={saveKey} data-testid={`video-key-save-${p.id}`}>
          {busy === "save" && <Loader2 size={14} className="animate-spin" />} {rec ? "替换" : "保存"}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted">
        在{" "}
        <a className="underline-offset-2 hover:underline" href={info.whereUrl} target="_blank" rel="noreferrer">
          {info.where} <ExternalLink size={10} className="inline" />
        </a>{" "}
        获取。Key 用 AES-256-GCM 加密存在服务端，页面和接口都只显示打码后的样子。
      </p>
      {result && (
        <div className={`mt-2 flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${result.ok ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"}`} data-testid={`video-test-result-${p.id}`}>
          {result.ok ? <CheckCircle2 size={14} className="mt-px shrink-0" /> : <XCircle size={14} className="mt-px shrink-0" />}
          <span className="whitespace-pre-wrap break-all">{result.message}</span>
        </div>
      )}
    </div>
  );
}

function SpacePicker({ mode, cfg, onCfg }: { mode: VideoMode; cfg: Cfg; onCfg: (c: Cfg) => void }) {
  const cur = cfg.hfSpace[mode];
  const isCustom = cur.startsWith("custom:");
  const [custom, setCustom] = useState(isCustom ? cur.slice(7).split("#")[0] : "");
  const [tool, setTool] = useState(isCustom ? cur.slice(7).split("#")[1] || "" : "");
  const [editing, setEditing] = useState(isCustom);
  /** 选中的预设（先改界面再等服务端确认） */
  const [sel, setSel] = useState(cur);
  useEffect(() => setSel(cur), [cur]);
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const presets = HF_PRESETS.filter((p) => p.mode === mode);
  const valid = isSpaceName(custom.trim()) && (!tool.trim() || isToolName(tool.trim()));

  async function setChoice(v: string) {
    try {
      const r = await api<{ config: Cfg }>("/api/video/config", { method: "PUT", body: { hfSpace: { [mode]: v } } });
      onCfg(r.config);
      toast("已保存", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }
  async function verify() {
    setBusy(true);
    setCheck(null);
    try {
      const r = await api<{ ok: boolean; message: string; tool?: string }>("/api/video/test", { body: { provider: "hf", space: custom.trim(), tool: tool.trim() || undefined } });
      setCheck({ ok: r.ok, message: r.message });
      if (r.ok) await setChoice(`custom:${custom.trim()}${tool.trim() ? "#" + tool.trim() : r.tool ? "#" + r.tool : ""}`);
    } catch (e) {
      setCheck({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-soft/60 p-3" data-testid={`video-space-${mode}`}>
      <div className="mb-1.5 text-xs font-semibold">{VIDEO_MODES.find((m) => m.id === mode)!.name}</div>
      <div className="flex flex-col gap-1.5">
        {presets.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="radio"
              className="mt-1 accent-[var(--acc)]"
              checked={sel === p.id && !editing}
              onChange={() => {
                setEditing(false);
                setSel(p.id);
                void setChoice(p.id);
              }}
            />
            <span>
              {p.name} <code className="text-[11px] text-muted">{p.space}</code>
              <span className="block text-[11px] text-muted">
                {p.note} · 最长 {p.maxSec} 秒 · 一般 {Math.round(p.eta / 10) * 10} 秒左右出片
              </span>
            </span>
          </label>
        ))}
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="radio" className="accent-[var(--acc)]" checked={editing} onChange={() => setEditing(true)} />
          自填其他 Space
        </label>
        {editing && (
          <div className="ml-6 space-y-1.5">
            <div className="flex flex-wrap gap-2">
              <input className="input min-w-0 flex-1" placeholder="owner/name，比如 Lightricks/ltx-video-distilled" value={custom} onChange={(e) => setCustom(e.target.value)} data-testid={`video-custom-${mode}`} />
              <input className="input w-44" placeholder="工具名（可不填）" value={tool} onChange={(e) => setTool(e.target.value)} />
              <button className="btn-primary btn-sm shrink-0" disabled={!valid || busy || !cfg.keys.hf} onClick={verify} data-testid={`video-custom-check-${mode}`}>
                {busy && <Loader2 size={13} className="animate-spin" />} 校验并使用
              </button>
            </div>
            {custom && !isSpaceName(custom.trim()) && <p className="text-[11px] text-bad">格式应为 owner/name，只能有字母、数字和 . _ -</p>}
            {!cfg.keys.hf && <p className="text-[11px] text-muted">先在上面添加 Hugging Face 令牌，才能校验 Space。</p>}
            <p className="text-[11px] text-muted">只支持开了 MCP 的 Space（在 Space 页面右上角有「Use via MCP」，或标签里有 mcp-server）。校验只读参数表，不消耗 GPU 额度。</p>
            {check && <p className={`whitespace-pre-wrap break-all text-[11px] ${check.ok ? "text-ok" : "text-bad"}`}>{check.message}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function VideoPanel() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  useEffect(() => {
    api<{ config: Cfg }>("/api/video/config")
      .then((r) => setCfg(r.config))
      .catch((e) => toast((e as Error).message, "err"));
  }, []);
  if (!cfg) return <div className="shimmer h-40 rounded-xl" />;

  async function setProvider(p: VideoProvider) {
    try {
      const r = await api<{ config: Cfg }>("/api/video/config", { method: "PUT", body: { provider: p } });
      setCfg(r.config);
      toast("默认服务已更新", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  return (
    <div className="space-y-4" data-testid="video-panel">
      <div className="flex items-start gap-2 rounded-xl bg-acc/10 px-3 py-2.5 text-[13px] leading-relaxed">
        <IdolAvatar size={24} mood="guide" exact />
        <span>
          视频由服务端代为请求，你的浏览器只访问 Prism 自己的域名，所以国内不挂代理也能用。生成好的视频会转存到本站，聊天和图库里都能看到。
        </span>
      </div>

      {VIDEO_PROVIDERS.map((p) => (
        <ProviderCard key={p.id} p={p} cfg={cfg} onCfg={setCfg} />
      ))}

      <div>
        <div className="label">默认服务</div>
        <div className="flex flex-wrap gap-2">
          {VIDEO_PROVIDERS.map((p) => (
            <button key={p.id} className={`chip px-3 py-1.5 text-sm ${cfg.provider === p.id ? "chip-on" : ""}`} onClick={() => setProvider(p.id)} data-testid={`video-default-${p.id}`}>
              {p.short}
              {!cfg.keys[p.id] && <span className="text-[11px] text-muted">（未添加 Key）</span>}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-muted">聊天页的「视频」里也可以每次临时换。智谱不支持首尾帧，选首尾帧时会自动用 Hugging Face。</p>
      </div>

      <div>
        <div className="label">Hugging Face 每种模式用哪个 Space</div>
        <div className="grid gap-2">
          {VIDEO_MODES.map((m) => (
            <SpacePicker key={m.id} mode={m.id} cfg={cfg} onCfg={setCfg} />
          ))}
        </div>
      </div>

      <VideoHelp />
    </div>
  );
}

/** 应用内的使用说明（和 docs/video.md 同一份内容的精简版） */
function VideoHelp() {
  const Item = ({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) => (
    <details className="group rounded-xl border border-rule px-3 py-2" open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold">
        <ChevronDown size={14} className="transition group-open:rotate-180" /> {title}
      </summary>
      <div className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-ink/80">{children}</div>
    </details>
  );
  return (
    <div className="space-y-2" data-testid="video-help">
      <div className="label">使用说明</div>
      <Item title="三分钟上手" open>
        <ol className="list-decimal space-y-1 pl-5">
          <li>在上面添加一个 Key：Hugging Face 令牌，或智谱 API Key（两个都加也行）。</li>
          <li>点「测试连接」，看到账号名或「Key 有效」就说明通了。</li>
          <li>回到聊天页，输入框上方切到「视频」，选文生视频 / 图生视频 / 首尾帧，写描述后发送。也可以直接输入 <code>/视频 描述</code>。</li>
          <li>一般 1–2 分钟出片。期间可以离开页面，生成完会自动存进对话和图库。</li>
        </ol>
      </Item>
      <Item title="怎么创建 Hugging Face 令牌">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            登录 huggingface.co（没有账号先注册并验证邮箱），打开{" "}
            <a className="underline" href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">
              Settings → Access Tokens
            </a>
            。
          </li>
          <li>点「Create new token」，Token type 选 <b>Read</b>（只读就够了：调用公开 Space 不需要写权限），起个名字比如 prism，创建。</li>
          <li>复制 <code>hf_</code> 开头的令牌，粘到上面保存。令牌只显示一次，丢了就删掉重建。</li>
        </ol>
        <p>
          用 Fine-grained 令牌也可以，但不用勾「Make calls to Inference Providers」——那是付费推理服务的权限，调用 Space 用不到。令牌的作用是让 GPU 用量记在你自己的账号上（不带令牌时按匿名用户算，额度更少）。
        </p>
      </Item>
      <Item title="免费额度是怎么算的">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Hugging Face</b>：预设的 Space 都跑在 ZeroGPU 上，按账号每天计 GPU 时长：免费账号约 5 分钟，PRO 约 40 分钟，从第一次使用起 24 小时后重置。扣的是 Space 实际占用 GPU 的时间（不含排队），几秒的短视频大致占几十秒，免费账号一天能出几段（视 Space 和时长而定）。额度用完会提示「今天的免费 GPU 额度用完了」。
          </li>
          <li>
            <b>智谱 CogVideoX-Flash</b>：官方价格表标注为免费模型，并发数受账号等级限制，时长和分辨率由智谱决定。只支持文生视频和图生视频（一张图）。
          </li>
        </ul>
      </Item>
      <Item title="怎么申请智谱 API Key">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            打开{" "}
            <a className="underline" href="https://bigmodel.cn" target="_blank" rel="noreferrer">
              bigmodel.cn
            </a>{" "}
            注册登录（国内手机号即可）。
          </li>
          <li>
            进入{" "}
            <a className="underline" href="https://bigmodel.cn/usercenter/proj-mgmt/apikeys" target="_blank" rel="noreferrer">
              个人中心 → API Keys
            </a>
            ，点「添加新的 API Key」，复制后粘到上面。
          </li>
          <li>CogVideoX-Flash 不扣费，不需要充值。</li>
        </ol>
      </Item>
      <Item title="为什么国内也能用">
        <p>
          调用 Hugging Face 和智谱的是部署在 Vercel 上的 Prism 服务端，不是你的浏览器；生成好的视频也会由服务端下载转存，浏览器播放的是 Prism 自己的 <code>/api/files/…</code> 地址。所以你的电脑只要能打开 Prism 的域名就行。服务端只会请求 huggingface.co、*.hf.space 和 open.bigmodel.cn 这几个域名。
        </p>
      </Item>
      <Item title="常见报错和处理">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>今天的免费 GPU 额度用完了</b>：缩短时长、换智谱，或等额度重置；经常用可以考虑 HF PRO。
          </li>
          <li>
            <b>生成超时</b>：Vercel 函数最长只能跑 300 秒，Space 排队久了会超时。把时长调到 2–3 秒，或换「LTX-Video」这类快的 Space。
          </li>
          <li>
            <b>令牌无效 / API Key 无效</b>：Key 过期、被删除或复制少了字符。重新添加后点「测试连接」。换过 PRISM_SECRET 时旧 Key 也解不开，需要重新添加。
          </li>
          <li>
            <b>Space 不可用</b>：Space 可能在休眠、出错或被作者改了参数。换回预设的 Space，或稍后再试。
          </li>
          <li>
            <b>内容没有通过审核</b>（智谱）：描述或参考图里可能有敏感内容，换个说法。
          </li>
          <li>
            <b>视频没能转存</b>：视频超过大小上限（接了 Vercel Blob 时 20MB，存 MySQL 时 15MB）或下载失败，会先播放服务商的临时链接，过一段时间失效，请尽快下载。
          </li>
        </ul>
      </Item>
    </div>
  );
}
