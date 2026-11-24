"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CloudDownload, Loader2, Palette, Settings2 } from "lucide-react";
import { Modal, PageHeader, Toggle, toast } from "@/components/ui";
import { uid } from "@/lib/client/api";
import { loadDoc, saveItems, setPrefs, sxIndex, useLibPrefs, usePromptDoc, useRecent } from "@/lib/client/promptlib";
import type { LibManifest, UserPrompt } from "@/lib/prompts/types";
import { SxBrowser } from "./SxBrowser";
import { MineGrid, SavedList } from "./MinePanel";

// 不常用的部分单独打包，用到时才下载
const R18Browser = dynamic(() => import("./R18Browser"), {
  ssr: false,
  loading: () => (
    <div className="flex justify-center py-16 text-muted">
      <Loader2 className="animate-spin" />
    </div>
  ),
});
const SyncPanel = dynamic(() => import("./SyncPanel"), { ssr: false, loading: () => <div className="shimmer h-40 rounded-2xl" /> });

type Tab = "lib" | "mine" | "fav" | "recent" | "r18";
const RATIOS = ["", "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"];

export function PromptLibrary({ manifest }: { manifest: LibManifest }) {
  const prefs = useLibPrefs();
  const { doc, loaded } = usePromptDoc();
  const recent = useRecent();
  const [tab, setTabState] = useState<Tab>("lib");
  const [seen, setSeen] = useState<Set<Tab>>(() => new Set(["lib"]));
  const [editing, setEditing] = useState<Partial<UserPrompt> | null>(null);
  const [gate, setGate] = useState<null | (() => void)>(null);
  const [showSync, setShowSync] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 我的提示词 / 收藏：先用本机缓存显示，后台读最新
  useEffect(() => {
    void loadDoc().catch((e) => toast("读取我的提示词失败：" + (e as Error).message, "err"));
  }, []);
  // 地址里 ?tab=mine 之类直接打开对应分页
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (t && ["lib", "mine", "fav", "recent"].includes(t)) setTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 在设置里撤销了 18+ 确认：离开 R18 分页
  useEffect(() => {
    if (!prefs.adult && tab === "r18") setTabState("lib");
  }, [prefs.adult, tab]);

  const needAdult = useCallback((then?: () => void) => {
    setGate(() => () => {
      setPrefs({ adult: true });
      then?.();
    });
  }, []);

  function setTab(t: Tab, confirmed = false) {
    if (t === "r18" && !prefs.adult && !confirmed) return needAdult(() => setTab("r18", true));
    setTabState(t);
    setSeen((s) => (s.has(t) ? s : new Set(s).add(t)));
    scrollRef.current?.scrollTo({ top: 0 });
    const u = new URL(window.location.href);
    if (t === "lib") u.searchParams.delete("tab");
    else u.searchParams.set("tab", t);
    window.history.replaceState(window.history.state, "", u.pathname + u.search + (t === "lib" ? u.hash : ""));
  }

  const openSx = useCallback((id: number) => {
    window.location.hash = "open=sx:" + id;
    setTabState("lib");
  }, []);

  async function saveEdit() {
    const e = editing;
    if (!e) return;
    const prompt = (e.prompt || "").trim();
    if (!prompt) return toast("提示词不能为空", "err");
    const now = Date.now();
    const item: UserPrompt = {
      id: e.id || uid(),
      title: (e.title || "").trim() || prompt.replace(/\s+/g, " ").slice(0, 24),
      prompt,
      category: (e.category || "").trim() || undefined,
      ratio: e.ratio || undefined,
      cover: e.cover,
      createdAt: e.createdAt || now,
      updatedAt: now,
    };
    const exists = doc.items.some((x) => x.id === item.id);
    try {
      await saveItems(exists ? doc.items.map((x) => (x.id === item.id ? item : x)) : [item, ...doc.items]);
      setEditing(null);
      toast(exists ? "已保存" : "已添加到我的提示词", "ok");
      if (!exists && tab !== "mine") setTab("mine");
    } catch (err) {
      toast("保存失败：" + (err as Error).message, "err");
    }
  }

  const TABS: [Tab, string, number?][] = [
    ["lib", "灵感库"],
    ["mine", "我的", doc.items.length],
    ["fav", "收藏", doc.favs.length],
    ["recent", "最近", recent.length],
    ["r18", "R18"],
  ];
  const cats = Array.from(new Set(doc.items.map((x) => x.category || "").filter(Boolean)));

  return (
    <div ref={scrollRef} className="scroll-thin h-full overflow-y-auto">
      <PageHeader
        title="提示词"
        sub={`灵感库 ${manifest.sx.count.toLocaleString()} 条 · 数据来自「水仙的AI提示词」`}
        right={
          <div className="flex items-center gap-1.5">
            <Link href="/draw" className="btn-primary btn-sm hidden sm:inline-flex">
              <Palette size={13} /> 去画图
            </Link>
            <button className="btn-ghost btn-sm" onClick={() => setShowSync(true)} title="数据更新">
              <CloudDownload size={13} /> <span className="hidden sm:inline">数据更新</span>
            </button>
            <button className="rounded-lg p-1.5 text-muted hover:bg-hover" onClick={() => setShowSettings(true)} aria-label="显示设置" title="显示设置">
              <Settings2 size={18} />
            </button>
          </div>
        }
      />
      <div className="mx-auto max-w-7xl px-4 pb-10 pt-4 md:px-8">
        <div className="scroll-thin -mx-1 mb-4 flex gap-1 overflow-x-auto px-1" role="tablist">
          {TABS.map(([k, l, n]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`shrink-0 rounded-xl px-3.5 py-1.5 text-sm transition ${tab === k ? "bg-card font-semibold text-ink shadow-sm ring-1 ring-rule" : "text-muted hover:bg-hover hover:text-ink"}`}
              data-testid={`prompt-tab-${k}`}
            >
              {l}
              {k === "r18" && !prefs.adult && <span className="ml-1 text-[10px] text-muted">18+</span>}
              {!!n && <span className="ml-1 text-xs opacity-60">{n}</span>}
            </button>
          ))}
        </div>

        {/* 灵感库切走后保持挂载：回来时筛选条件和滚动位置都还在 */}
        <div hidden={tab !== "lib"}>
          <SxBrowser
            key={manifest.v}
            manifest={manifest}
            scrollRef={scrollRef}
            onNeedAdult={() => needAdult()}
            onSaveAsMine={(p) => setEditing({ title: p.title, prompt: p.prompt, ratio: p.ratio })}
          />
        </div>
        {tab === "mine" && <MineGrid loaded={loaded} onEdit={(p) => setEditing(p || {})} />}
        {(tab === "fav" || tab === "recent") && <SavedList kind={tab} manifest={manifest} onOpenSx={openSx} />}
        {seen.has("r18") && prefs.adult && <div hidden={tab !== "r18"}>{<R18Browser manifest={manifest} scrollRef={scrollRef} />}</div>}

        <footer className="mt-10 border-t border-rule pt-4 text-[11px] leading-relaxed text-muted" data-testid="prompt-attribution">
          灵感库基于「水仙的AI提示词」（
          <a className="underline hover:text-ink" href="https://github.com/BaYue-SYJ/shuixian-prompts" target="_blank" rel="noopener noreferrer">
            https://github.com/BaYue-SYJ/shuixian-prompts
          </a>
          ，作者：水仙，站点 prompt.qqsrc.com）的数据与分类体系，按其署名许可非商业使用；提示词原文与示例图片版权归各自原作者，示例图来自该项目图床。提示词仅供创作参考，请遵守各平台内容规范。
        </footer>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "编辑提示词" : "新建提示词"} wide>
        {editing && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void saveEdit();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_140px_110px]">
              <label>
                <span className="label">标题</span>
                <input className="input" value={editing.title || ""} maxLength={60} placeholder="不填就用提示词开头" onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </label>
              <label>
                <span className="label">分类</span>
                <input className="input" list="prompt-cats" value={editing.category || ""} maxLength={20} placeholder="如 人像" onChange={(e) => setEditing({ ...editing, category: e.target.value })} />
                <datalist id="prompt-cats">
                  {cats.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <label>
                <span className="label">建议比例</span>
                <select className="input" value={editing.ratio || ""} onChange={(e) => setEditing({ ...editing, ratio: e.target.value })}>
                  {RATIOS.map((r) => (
                    <option key={r} value={r}>
                      {r || "不指定"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="label">提示词</span>
              <textarea
                className="input min-h-48 resize-y leading-relaxed"
                value={editing.prompt || ""}
                maxLength={12000}
                autoFocus
                placeholder="写下画面描述。想做成模板时，把可替换的部分写成 {argument name=&quot;角色&quot; default=&quot;少女&quot;}"
                onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void saveEdit();
                  }
                }}
              />
            </label>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted">保存在服务器上，手机和电脑都能用 · Ctrl/⌘+Enter 保存</span>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
                  取消
                </button>
                <button type="submit" className="btn-primary">
                  保存
                </button>
              </div>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!gate} onClose={() => setGate(null)} title="内容确认">
        <p className="text-sm leading-relaxed">接下来的内容（R18 库、「大凶」分类）包含成人题材，仅限已满 18 岁的你自己查看。确认后只在这台设备上记住，可以随时在「显示设置」里撤销。</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setGate(null)}>
            不看了
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              const f = gate;
              setGate(null);
              f?.();
            }}
            data-testid="age-yes"
          >
            我已满 18 岁
          </button>
        </div>
      </Modal>

      <Modal open={showSync} onClose={() => setShowSync(false)} title="数据更新">
        {showSync && <SyncPanel onDone={() => setTabState("lib")} />}
      </Modal>

      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="显示设置">
        {showSettings && <LibSettings manifest={manifest} onAdult={() => needAdult()} />}
      </Modal>
    </div>
  );
}

function LibSettings({ manifest, onAdult }: { manifest: LibManifest; onAdult: () => void }) {
  const prefs = useLibPrefs();
  const [majors, setMajors] = useState<{ name: string; nsfw: boolean }[] | null>(null);
  useEffect(() => {
    sxIndex(manifest)
      .then((d) => setMajors(d.majors.map(([n], i) => ({ name: n, nsfw: d.nsfwMajors.includes(i) }))))
      .catch(() => setMajors([]));
  }, [manifest]);
  return (
    <div className="space-y-5 text-sm">
      <div>
        <div className="label">封面加载</div>
        <div className="space-y-1.5">
          {(
            [
              ["proxy", "经本站转发缩略图（推荐）", "图片压缩成小图，国内不挂代理也能看；第一次打开某张图稍慢，之后走缓存"],
              ["direct", "直连水仙库图床", "浏览器直接从 r2.qqsrc.com 加载原图，省服务器流量，但图大、在部分网络下打不开"],
            ] as const
          ).map(([k, l, d]) => (
            <label key={k} className={`flex cursor-pointer gap-2.5 rounded-xl border p-2.5 ${prefs.cover === k ? "border-acc bg-soft" : "border-rule"}`}>
              <input type="radio" name="cover" className="mt-0.5 accent-[var(--acc)]" checked={prefs.cover === k} onChange={() => setPrefs({ cover: k })} />
              <span>
                <span className="block font-medium">{l}</span>
                <span className="block text-xs text-muted">{d}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="label">隐藏分类（「全部」里不再显示，点分类本身仍可查看）</div>
        {!majors ? (
          <div className="shimmer h-20 rounded-xl" />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {majors
              .filter((m) => !m.nsfw)
              .map((m) => {
                const on = prefs.hidden.includes(m.name);
                return (
                  <button key={m.name} className={`chip ${on ? "line-through opacity-60" : ""}`} onClick={() => setPrefs({ hidden: on ? prefs.hidden.filter((x) => x !== m.name) : [...prefs.hidden, m.name] })}>
                    {m.name}
                  </button>
                );
              })}
          </div>
        )}
      </div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">显示成人内容</div>
          <p className="text-xs text-muted">「大凶」等分类和 R18 库。默认隐藏，打开前需要确认已满 18 岁；只对这台设备生效。</p>
        </div>
        <Toggle on={prefs.adult} onChange={(v) => (v ? onAdult() : setPrefs({ adult: false }))} />
      </div>
      {prefs.adult && (
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium">R18 详情默认显示中文版</div>
            <p className="text-xs text-muted">关掉则默认显示英文原文。</p>
          </div>
          <Toggle on={prefs.r18zh} onChange={(v) => setPrefs({ r18zh: v })} />
        </div>
      )}
    </div>
  );
}
