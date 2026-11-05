"use client";

import { useRef, useState } from "react";
import { Download, FileUp, Loader2, ShieldCheck } from "lucide-react";
import { useApp } from "./AppContext";
import { IdolSay, toast } from "./ui";
import { api } from "@/lib/client/api";
import { copy } from "@/lib/copy";

const SECTIONS = [
  { k: "channels", l: "渠道" },
  { k: "settings", l: "设置（含提示词预设、模型单价）" },
  { k: "tokens", l: "令牌" },
  { k: "conversations", l: "会话" },
] as const;
type Sec = (typeof SECTIONS)[number]["k"];

interface Split {
  count: number;
  overwrite: string[];
  add: string[];
  keep: number;
}
interface Preview {
  createdAt: number;
  sections: Sec[];
  detail: {
    channels?: Split & { keyProblems: string[] };
    settings?: { changes: { label: string; from: string; to: string }[]; presets: Split; pricing: { rules: number; current: number } };
    tokens?: Split & { defaultKeyChanges: boolean };
    conversations?: { count: number; overwrite: string[]; add: number; addSample: string[]; keep: number };
  };
}

// Vercel 函数请求体上限约 4.5MB
const MAX_UPLOAD = 4.3 * 1024 * 1024;

function Names({ list, more }: { list: string[]; more?: number }) {
  if (!list.length && !more) return <span className="text-muted">无</span>;
  const shown = list.slice(0, 8);
  const rest = list.length - shown.length + (more || 0);
  return (
    <span>
      {shown.join("、")}
      {rest > 0 && <span className="text-muted"> 等 {list.length + (more || 0)} 项</span>}
    </span>
  );
}

export default function BackupPanel() {
  const { refresh, refreshConversations } = useApp();
  const [secs, setSecs] = useState<Sec[]>(["channels", "settings", "tokens", "conversations"]);
  const [pw, setPw] = useState("");
  const [exporting, setExporting] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [rpw, setRpw] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pick, setPick] = useState<Sec[]>([]);
  const [restoring, setRestoring] = useState(false);

  async function doExport() {
    if (exporting) return;
    if (pw.length < 6) return toast("备份密码至少 6 位", "err");
    if (!secs.length) return toast("至少选一项", "err");
    setExporting(true);
    try {
      const res = await fetch("/api/backup/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw, sections: secs }) });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `导出失败（${res.status}）`);
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || "prism-backup.prismbak";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast(blob.size > MAX_UPLOAD ? "备份已下载。文件超过 4MB，恢复时可能超出 Vercel 的上传上限，建议把会话单独备份" : "备份已下载，请妥善保管备份密码", blob.size > MAX_UPLOAD ? "err" : "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setExporting(false);
    }
  }

  async function onFile(f: File | undefined) {
    setPreview(null);
    if (!f) return;
    if (f.size > MAX_UPLOAD) return toast("备份文件超过 4.3MB，超出了 Vercel 的上传上限。可以在本地运行 Prism 恢复，或者分开备份会话。", "err");
    setFile({ name: f.name, text: await f.text() });
  }

  async function doPreview() {
    if (!file || previewing) return;
    setPreviewing(true);
    setPreview(null);
    try {
      const r = await api<{ preview: Preview }>("/api/backup/preview", { body: { file: file.text, password: rpw } });
      setPreview(r.preview);
      setPick(r.preview.sections);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setPreviewing(false);
    }
  }

  async function doRestore() {
    if (!file || !preview || restoring || !pick.length) return;
    if (!confirm(`确定按上面的预览恢复「${pick.map((k) => SECTIONS.find((s) => s.k === k)!.l.replace(/（.*）/, "")).join("、")}」吗？同一项会被覆盖，备份里没有的保持不动。`)) return;
    setRestoring(true);
    try {
      await api("/api/backup/restore", { body: { file: file.text, password: rpw, sections: pick } });
      toast("恢复完成！", "ok");
      setPreview(null);
      setFile(null);
      setRpw("");
      if (fileRef.current) fileRef.current.value = "";
      await Promise.all([refresh(), pick.includes("conversations") ? refreshConversations() : null]);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setRestoring(false);
    }
  }

  const d = preview?.detail;
  const toggle = (arr: Sec[], k: Sec) => (arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]);

  return (
    <div className="space-y-5" data-testid="backup-panel">
      <IdolSay>{copy.backup.say}</IdolSay>

      <div>
        <div className="label">导出哪些内容</div>
        <div className="flex flex-wrap gap-1.5">
          {SECTIONS.map((s) => (
            <button key={s.k} className={`chip ${secs.includes(s.k) ? "chip-on" : ""}`} onClick={() => setSecs(toggle(secs, s.k))}>
              {s.l}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input className="input max-w-xs flex-1" type="password" autoComplete="new-password" placeholder="设一个备份密码（至少 6 位）" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="btn-primary" onClick={() => void doExport()} disabled={exporting}>
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} 导出加密备份
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted">密码丢了就打不开备份。图片文件本身不在备份里，会话里只保留图片链接。</p>
      </div>

      <div className="border-t border-rule pt-4">
        <div className="label">从备份恢复</div>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".prismbak,application/json,application/octet-stream" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
            <FileUp size={14} /> {file ? file.name : "选择备份文件"}
          </button>
          <input className="input max-w-xs flex-1" type="password" autoComplete="off" placeholder="备份密码" value={rpw} onChange={(e) => setRpw(e.target.value)} />
          <button className="btn-ghost" onClick={() => void doPreview()} disabled={!file || !rpw || previewing}>
            {previewing ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} 先预览
          </button>
        </div>

        {preview && d && (
          <div className="mt-4 space-y-3 rounded-xl border border-rule bg-soft/50 p-4 text-sm" data-testid="backup-preview">
            <div className="text-xs text-muted">备份时间：{new Date(preview.createdAt).toLocaleString("zh-CN")}。勾选要恢复的部分：</div>
            {d.channels && (
              <PreviewBlock on={pick.includes("channels")} onToggle={() => setPick(toggle(pick, "channels"))} title={`渠道（备份里 ${d.channels.count} 个）`}>
                <Row k="会覆盖"><Names list={d.channels.overwrite} /></Row>
                <Row k="会新增"><Names list={d.channels.add} /></Row>
                <Row k="保持不动">{d.channels.keep} 个</Row>
                {d.channels.keyProblems.length > 0 && (
                  <p className="mt-1 rounded-lg bg-warn/10 px-2 py-1 text-xs">
                    {copy.backup.secretWarn}
                    {d.channels.keyProblems.join("、")}
                  </p>
                )}
              </PreviewBlock>
            )}
            {d.settings && (
              <PreviewBlock on={pick.includes("settings")} onToggle={() => setPick(toggle(pick, "settings"))} title="设置">
                <Row k="会改动">
                  {d.settings.changes.length ? d.settings.changes.map((c) => `${c.label}：${c.from} → ${c.to}`).join("；") : <span className="text-muted">和现在一样</span>}
                </Row>
                <Row k="预设">
                  覆盖 <Names list={d.settings.presets.overwrite} />；新增 <Names list={d.settings.presets.add} />
                </Row>
                <Row k="模型单价">
                  整份替换：现在 {d.settings.pricing.current} 条 → 备份里 {d.settings.pricing.rules} 条
                </Row>
              </PreviewBlock>
            )}
            {d.tokens && (
              <PreviewBlock on={pick.includes("tokens")} onToggle={() => setPick(toggle(pick, "tokens"))} title={`令牌（备份里 ${d.tokens.count} 个）`}>
                <Row k="会覆盖"><Names list={d.tokens.overwrite} /></Row>
                <Row k="会新增"><Names list={d.tokens.add} /></Row>
                <Row k="保持不动">{d.tokens.keep} 个</Row>
                {d.tokens.defaultKeyChanges && <p className="mt-1 rounded-lg bg-warn/10 px-2 py-1 text-xs">默认令牌的 Key 会换成备份里的，现在用着默认令牌的客户端要跟着改。</p>}
              </PreviewBlock>
            )}
            {d.conversations && (
              <PreviewBlock on={pick.includes("conversations")} onToggle={() => setPick(toggle(pick, "conversations"))} title={`会话（备份里 ${d.conversations.count} 个）`}>
                <Row k="会覆盖"><Names list={d.conversations.overwrite} /></Row>
                <Row k="会新增"><Names list={d.conversations.addSample} more={d.conversations.add - d.conversations.addSample.length} /></Row>
                <Row k="保持不动">{d.conversations.keep} 个</Row>
              </PreviewBlock>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost" onClick={() => setPreview(null)} disabled={restoring}>
                取消
              </button>
              <button className="btn-primary" onClick={() => void doRestore()} disabled={restoring || !pick.length}>
                {restoring && <Loader2 size={14} className="animate-spin" />} 确认恢复
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewBlock({ title, on, onToggle, children }: { title: string; on: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border bg-card p-3 transition ${on ? "border-acc/50" : "border-rule opacity-60"}`}>
      <label className="mb-1.5 flex cursor-pointer items-center gap-2 font-semibold">
        <input type="checkbox" checked={on} onChange={onToggle} className="accent-[var(--acc)]" />
        {title}
      </label>
      <div className="space-y-0.5 text-xs">{children}</div>
    </div>
  );
}
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-muted">{k}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}
