"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useApp } from "./AppContext";
import { Modal, toast } from "./ui";
import { api } from "@/lib/client/api";
import type { Preset } from "@/lib/types";

interface Form {
  id?: string;
  name: string;
  system: string;
  temperature: string;
}

/**
 * 提示词预设：增删改都等服务端写入成功后再更新界面。
 * 以前是先改界面再保存（乐观更新），列表里已经出现了新预设、请求其实还没写进库；
 * 这时马上打开聊天页，服务端渲染读到的还是旧列表，空白页上就看不到新预设。
 * 预设很少改、写一次只要一条 SQL，等确认再显示更稳。
 */
export default function PresetManager() {
  const { presets, patchBoot, revalidatePresets } = useApp();
  const [edit, setEdit] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // 打开设置页时直接读一次库，免得在旧列表上改完整份保存、把别处刚加的预设覆盖掉
  useEffect(() => {
    void revalidatePresets(true);
  }, [revalidatePresets]);

  const setPresets = (list: Preset[]) => patchBoot((b) => ({ ...b, presets: list }));

  async function commit(next: Preset[], okText: string) {
    try {
      const r = await api<{ presets: Preset[] }>("/api/presets", { method: "PUT", body: { presets: next } });
      setPresets(r.presets);
      toast(okText, "ok");
      return true;
    } catch (e) {
      toast((e as Error).message, "err");
      return false;
    }
  }

  async function save() {
    if (!edit || saving) return;
    const name = edit.name.trim();
    if (!name) return toast("给预设起个名字吧", "err");
    if (!edit.system.trim()) return toast("系统提示词不能为空", "err");
    const t = edit.temperature === "" ? undefined : Number(edit.temperature);
    const item: Preset = { id: edit.id || Math.random().toString(36).slice(2, 10), name, system: edit.system, ...(t != null && Number.isFinite(t) ? { temperature: t } : {}) };
    const next = edit.id ? presets.map((p) => (p.id === edit.id ? item : p)) : [...presets, item];
    setSaving(true);
    const ok = await commit(next, edit.id ? "预设已保存" : "预设已添加，新建对话时就能选了");
    setSaving(false);
    if (ok) setEdit(null);
  }

  async function del(p: Preset) {
    if (deleting || !confirm(`删除预设「${p.name}」？已经用它开始的对话不受影响。`)) return;
    setDeleting(p.id);
    await commit(
      presets.filter((x) => x.id !== p.id),
      "预设已删除",
    );
    setDeleting(null);
  }

  return (
    <div data-testid="preset-manager">
      {presets.length === 0 ? (
        <p className="mb-3 text-sm text-muted">还没有预设。把常用的系统提示词存成预设，新建对话时点一下就能用。</p>
      ) : (
        <div className="mb-3 divide-y divide-rule rounded-xl border border-rule">
          {presets.map((p) => (
            <div key={p.id} className="flex items-start gap-3 px-3 py-2.5" data-testid="preset-item">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {p.name}
                  {p.temperature != null && <span className="ml-2 text-xs font-normal text-muted">温度 {p.temperature}</span>}
                </div>
                <div className="mt-0.5 line-clamp-2 text-xs text-muted">{p.system}</div>
              </div>
              <button className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink" aria-label={`编辑 ${p.name}`} onClick={() => setEdit({ id: p.id, name: p.name, system: p.system, temperature: p.temperature != null ? String(p.temperature) : "" })}>
                <Pencil size={14} />
              </button>
              <button className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-bad" aria-label={`删除 ${p.name}`} onClick={() => void del(p)} disabled={!!deleting}>
                {deleting === p.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}
      <button className="btn-ghost btn-sm" onClick={() => setEdit({ name: "", system: "", temperature: "" })}>
        <Plus size={14} /> 新建预设
      </button>

      <Modal open={!!edit} onClose={() => !saving && setEdit(null)} title={edit?.id ? "编辑预设" : "新建预设"}>
        {edit && (
          <div className="space-y-4">
            <div>
              <div className="label">名字</div>
              <input className="input" maxLength={30} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="比如：中英互译" />
            </div>
            <div>
              <div className="label">系统提示词</div>
              <textarea className="input min-h-36 text-sm" value={edit.system} onChange={(e) => setEdit({ ...edit, system: e.target.value })} placeholder="你是一位专业的翻译……" />
            </div>
            <div>
              <div className="label">温度（可不填，不填就用当前对话的）</div>
              <input className="input w-32" type="number" min={0} max={2} step={0.1} value={edit.temperature} onChange={(e) => setEdit({ ...edit, temperature: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setEdit(null)} disabled={saving}>
                取消
              </button>
              <button className="btn-primary" onClick={() => void save()} disabled={saving}>
                {saving && <Loader2 size={14} className="animate-spin" />} 保存
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
