"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Flame, Loader2, RefreshCw, Search, Shuffle, Star } from "lucide-react";
import { coverUrl, sxChunk, sxIndex, sxPinyin, useLibPrefs, usePromptDoc } from "@/lib/client/promptlib";
import type { LibManifest, SxIndex } from "@/lib/prompts/types";
import { PromptDrawer, type DrawerEntry } from "./PromptDrawer";

const BATCH = 48;
const ALIAS: Record<string, string> = { "New-OM": "欧美新作", "New-SFW": "全年龄新作", "New欧美": "欧美精选", "（大凶）": "大凶", "其他/未归类": "其他" };
const majorName = (n: string) => ALIAS[n] || n.replace(/[（）()]/g, "");
const subName = (n: string) => ALIAS[n] || n;
export type SxSort = "mix" | "hot" | "new" | "rand";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(a: T[], seed: number) {
  const r = rng(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const today = () => {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};

/** 地址栏 #m=大类&s=小类&q=关键词&sort=排序&open=sx:123：刷新、分享后还是同一个视图 */
function readHash() {
  const p = new URLSearchParams(typeof window === "undefined" ? "" : window.location.hash.slice(1));
  return { m: p.get("m") || "", s: p.get("s") || "", q: p.get("q") || "", sort: (p.get("sort") as SxSort) || "mix", open: p.get("open") || "" };
}

function Skeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-hidden>
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="card overflow-hidden">
          <div className="shimmer aspect-[4/5]" />
          <div className="space-y-1.5 p-2.5">
            <div className="shimmer h-3 w-4/5 rounded" />
            <div className="shimmer h-2.5 w-1/2 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

const Card = memo(function Card({
  i,
  id,
  title,
  sub,
  likes,
  nImg,
  cover,
  color,
  fav,
  onOpen,
  onWarm,
}: {
  i: number;
  id: number;
  title: string;
  sub: string;
  likes: number;
  nImg: number;
  cover: string;
  color: string | null;
  fav: boolean;
  onOpen: (i: number) => void;
  onWarm: (i: number) => void;
}) {
  const [ok, setOk] = useState(false);
  const [bad, setBad] = useState(false);
  const c = color || "#7c5cff";
  return (
    <a
      href={`#open=sx:${id}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        onOpen(i);
      }}
      onPointerEnter={() => onWarm(i)}
      onFocus={() => onWarm(i)}
      className="group card block overflow-hidden transition hover:-translate-y-0.5 hover:shadow-md"
      data-testid="prompt-card"
    >
      <div className="relative aspect-[4/5] overflow-hidden" style={{ background: `linear-gradient(140deg, ${c}26 0%, ${c}88 135%)` }}>
        {!ok && <span className="absolute inset-0 flex items-center justify-center text-4xl font-black text-white/70">{sub.slice(0, 1)}</span>}
        {cover && !bad && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            width={360}
            height={450}
            onLoad={() => setOk(true)}
            onError={() => setBad(true)}
            className={`absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] ${ok ? "opacity-100" : "opacity-0"}`}
          />
        )}
        {nImg > 1 && <span className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">{nImg} 图</span>}
        {fav && (
          <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-warn">
            <Star size={12} fill="currentColor" />
          </span>
        )}
      </div>
      <div className="p-2.5">
        <div className="line-clamp-2 text-[13px] font-medium leading-snug">{title}</div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
          <span className="truncate">{sub}</span>
          <span className="shrink-0">{likes} 赞</span>
        </div>
      </div>
    </a>
  );
});

export function SxBrowser({
  manifest,
  scrollRef,
  onSaveAsMine,
  onNeedAdult,
}: {
  manifest: LibManifest;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onSaveAsMine: (p: { title: string; prompt: string; ratio?: string }) => void;
  onNeedAdult: () => void;
}) {
  const prefs = useLibPrefs();
  const { doc } = usePromptDoc();
  const [idx, setIdx] = useState<SxIndex | null>(null);
  const [err, setErr] = useState("");
  const init = useRef(readHash());
  const [major, setMajor] = useState(-1);
  const [sub, setSub] = useState(-1);
  const [q, setQ] = useState(init.current.q);
  const dq = useDeferredValue(q.trim().toLowerCase());
  const [sort, setSort] = useState<SxSort>(["mix", "hot", "new", "rand"].includes(init.current.sort) ? init.current.sort : "mix");
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [full, setFull] = useState(false);
  const [fullHay, setFullHay] = useState<string[] | null>(null);
  const [fullLoading, setFullLoading] = useState(false);
  const [pyHay, setPyHay] = useState<string[] | null>(null);
  const [shown, setShown] = useState(BATCH);
  const [open, setOpen] = useState<number | null>(null);
  const [body, setBody] = useState<{ i: number; text: string; imgs: string[] } | { i: number; error: string } | null>(null);
  const [pick, setPick] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  // 首屏索引（页面渲染时已经预加载，这里多半直接命中）
  useEffect(() => {
    let alive = true;
    sxIndex(manifest)
      .then((d) => {
        if (!alive) return;
        setIdx(d);
        const h = init.current;
        const mi = h.m ? d.majors.findIndex((x) => x[0] === h.m) : -1;
        const si = h.s ? d.subs.findIndex((x) => x[0] === h.s) : -1;
        setMajor(mi);
        setSub(si);
      })
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [manifest]);

  const hidden = useMemo(() => {
    const s = new Set<number>();
    if (!idx) return s;
    idx.majors.forEach(([n], i) => {
      if ((!prefs.adult && idx.nsfwMajors.includes(i)) || prefs.hidden.includes(n)) s.add(i);
    });
    return s;
  }, [idx, prefs.adult, prefs.hidden]);
  const hiddenSubs = useMemo(() => new Set(prefs.adult || !idx ? [] : idx.nsfwSubs || []), [idx, prefs.adult]);

  /** 每条的检索串：标题、小类、大类、风格标签 */
  const hay = useMemo(() => (idx ? idx.rows.map((r) => `${r[1]} ${idx.subs[r[2]][0]} ${idx.majors[idx.subs[r[2]][1]][0]} ${r[6]}`.toLowerCase()) : []), [idx]);

  // 关键词是纯字母（如 sbpk）时顺带按拼音首字母搜（首字母表 18KB，用到时才下载）
  const needPy = !!idx && manifest.sx.py && /(^|\s)[a-z]{2,}(\s|$)/.test(dq);
  useEffect(() => {
    if (!needPy || pyHay || !idx) return;
    let alive = true;
    sxPinyin(manifest)
      .then((map) => {
        if (!alive) return;
        const ini = (s: string) => Array.from(s, (ch) => map[ch] || (/[a-z0-9]/i.test(ch) ? ch.toLowerCase() : "")).join("");
        setPyHay(idx.rows.map((r) => ini(r[1]) + " " + ini(idx.subs[r[2]][0]) + " " + ini(idx.majors[idx.subs[r[2]][1]][0])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [needPy, pyHay, idx, manifest]);

  // 勾选「搜索正文」时下载全部正文（约 4MB，只下载一次）
  useEffect(() => {
    if (!full || fullHay || !idx) return;
    let alive = true;
    setFullLoading(true);
    Promise.all(Array.from({ length: manifest.sx.chunks }, (_, n) => sxChunk(manifest, n)))
      .then((all) => alive && setFullHay(all.flat().map((x) => x[0].toLowerCase())))
      .catch(() => alive && setFull(false))
      .finally(() => alive && setFullLoading(false));
    return () => {
      alive = false;
    };
  }, [full, fullHay, idx, manifest]);

  const majorOf = useCallback((i: number) => (idx ? idx.subs[idx.rows[i][2]][1] : -1), [idx]);

  const view = useMemo(() => {
    if (!idx) return [] as number[];
    const words = dq.split(/\s+/).filter(Boolean);
    const out: number[] = [];
    for (let i = 0; i < idx.rows.length; i++) {
      const r = idx.rows[i];
      const mi = idx.subs[r[2]][1];
      if (major >= 0 ? mi !== major : hidden.has(mi)) continue;
      if (hiddenSubs.has(r[2]) || (!prefs.adult && idx.nsfwMajors.includes(mi))) continue;
      if (sub >= 0 && r[2] !== sub) continue;
      if (words.length) {
        const h = hay[i];
        const f = full && fullHay ? fullHay[i] : "";
        const py = pyHay ? pyHay[i] : "";
        if (!words.every((w) => h.includes(w) || (f && f.includes(w)) || (py && /^[a-z]+$/.test(w) && py.includes(w)))) continue;
      }
      out.push(i);
    }
    if (sort === "new") out.sort((a, b) => idx.rows[b][0] - idx.rows[a][0]);
    else if (sort === "rand") shuffle(out, seed);
    else if (sort === "mix" && major < 0 && !words.length) {
      // 推荐：各大类按热度轮流取，首页不会被单一分类霸屏
      const by = new Map<number, number[]>();
      for (const i of out) {
        const m = majorOf(i);
        if (!by.has(m)) by.set(m, []);
        by.get(m)!.push(i);
      }
      const qs = Array.from(by.values());
      const mixed: number[] = [];
      for (let k = 0; mixed.length < out.length; k++) for (const l of qs) if (k < l.length) mixed.push(l[k]);
      return mixed;
    }
    return out;
  }, [idx, dq, major, sub, hidden, hiddenSubs, prefs.adult, hay, full, fullHay, pyHay, sort, seed, majorOf]);

  // 条件变了：从头显示、滚回顶部
  useEffect(() => {
    setShown(BATCH);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [view, scrollRef]);

  // 滚到底附近自动接着显示下一批
  useEffect(() => {
    const el = moreRef.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setShown((s) => Math.min(view.length, s + BATCH)), {
      root: scrollRef.current,
      rootMargin: "1200px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [view.length, shown, scrollRef]);

  // 地址栏同步
  useEffect(() => {
    if (!idx) return;
    const p = new URLSearchParams();
    if (major >= 0) p.set("m", idx.majors[major][0]);
    if (sub >= 0) p.set("s", idx.subs[sub][0]);
    if (q.trim()) p.set("q", q.trim());
    if (sort !== "mix") p.set("sort", sort);
    if (open != null) p.set("open", "sx:" + idx.rows[open][0]);
    const h = p.toString();
    window.history.replaceState(window.history.state, "", h ? "#" + h : window.location.pathname + window.location.search);
  }, [idx, major, sub, q, sort, open]);

  // 键盘 / 聚焦搜索
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement | null)?.tagName || "");
      if (e.key === "/" && !typing && open == null) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open]);

  const warm = useCallback(
    (i: number) => {
      if (idx) void sxChunk(manifest, Math.floor(i / idx.chunk)).catch(() => {});
    },
    [idx, manifest],
  );

  const openAt = useCallback(
    (i: number) => {
      if (!idx) return;
      const mi = idx.subs[idx.rows[i][2]][1];
      if (!prefs.adult && (idx.nsfwMajors.includes(mi) || (idx.nsfwSubs || []).includes(idx.rows[i][2]))) return onNeedAdult();
      setOpen(i);
      setBody(null);
      sxChunk(manifest, Math.floor(i / idx.chunk))
        .then((c) => {
          const [text, imgs] = c[i % idx.chunk];
          setBody({ i, text, imgs });
        })
        .catch((e) => setBody({ i, error: "加载失败：" + (e as Error).message }));
    },
    [idx, manifest, prefs.adult, onNeedAdult],
  );

  // 收藏、链接里带着 #open=sx:123 打开时直接弹出那一条
  useEffect(() => {
    if (!idx) return;
    const o = init.current.open;
    init.current.open = "";
    const id = o.startsWith("sx:") ? Number(o.slice(3)) : 0;
    if (!id) return;
    const i = idx.rows.findIndex((r) => r[0] === id);
    if (i >= 0) openAt(i);
  }, [idx, openAt]);
  // 其它页面（收藏列表的「原条目」）改了 hash 也能打开
  useEffect(() => {
    const on = () => {
      const o = new URLSearchParams(window.location.hash.slice(1)).get("open") || "";
      if (!idx || !o.startsWith("sx:")) return;
      const i = idx.rows.findIndex((r) => r[0] === Number(o.slice(3)));
      if (i >= 0 && i !== open) openAt(i);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [idx, open, openAt]);

  const favs = useMemo(() => new Set(doc.favs.map((f) => f.key)), [doc.favs]);
  const counts = useMemo(() => {
    const c = new Map<number, number>();
    const cs = new Map<number, number>();
    if (!idx) return { c, cs, total: 0 };
    let total = 0;
    for (const r of idx.rows) {
      const mi = idx.subs[r[2]][1];
      if (!prefs.adult && (idx.nsfwMajors.includes(mi) || hiddenSubs.has(r[2]))) continue;
      c.set(mi, (c.get(mi) || 0) + 1);
      cs.set(r[2], (cs.get(r[2]) || 0) + 1);
      if (!hidden.has(mi)) total++;
    }
    return { c, cs, total };
  }, [idx, prefs.adult, hidden, hiddenSubs]);

  /** 今日推荐：按日期固定的一组，点「换一批」换 */
  const picks = useMemo(() => {
    if (!idx) return [];
    const pool: number[] = [];
    idx.rows.forEach((r, i) => {
      const mi = idx.subs[r[2]][1];
      if (!hidden.has(mi) && !hiddenSubs.has(r[2]) && r[3] && r[4] > 0) pool.push(i);
    });
    return shuffle(pool, today() * 31 + pick).slice(0, 6);
  }, [idx, hidden, hiddenSubs, pick]);

  if (err)
    return (
      <div className="card p-6 text-center text-sm">
        <p className="text-bad">提示词库加载失败：{err}</p>
        <button className="btn-ghost btn-sm mt-3" onClick={() => window.location.reload()}>
          <RefreshCw size={13} /> 重新加载
        </button>
      </div>
    );

  const subs = idx && major >= 0 ? idx.subs.map((s, i) => [s, i] as const).filter(([s, i]) => s[1] === major && counts.cs.get(i)) : [];
  const pos = open != null ? view.indexOf(open) : -1;
  const row = open != null && idx ? idx.rows[open] : null;
  const entry: DrawerEntry | null =
    row && idx
      ? (() => {
          const mi = idx.subs[row[2]][1];
          const color = idx.majors[mi][1];
          const imgs = body && "text" in body && body.i === open ? body.imgs : row[3] ? [row[3]] : [];
          const mn = majorName(idx.majors[mi][0]);
          const sn = subName(idx.subs[row[2]][0]);
          return {
            key: "sx:" + row[0],
            src: "sx",
            title: row[1],
            crumb: mn === sn ? mn : `${mn} / ${sn}`,
            text: body && body.i === open && "text" in body ? body.text : null,
            error: body && body.i === open && "error" in body ? body.error : undefined,
            images: imgs.map((p) => coverUrl(manifest, p, 720, prefs.cover)),
            coverPath: row[3],
            ratio: row[7] || undefined,
            color,
            badges: [
              { text: sn },
              { text: `${row[4]} 赞` },
              ...(row[7] ? [{ text: `建议比例 ${row[7]}`, acc: true }] : []),
              ...(row[6] ? row[6].split("|").map((t) => ({ text: t })) : []),
              { text: `#${row[0]}` },
            ],
          } satisfies DrawerEntry;
        })()
      : null;

  return (
    <div>
      {/* 搜索 + 排序 */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-rule bg-card px-3 py-2 focus-within:border-acc sm:max-w-md">
          <Search size={15} className="shrink-0 text-muted" />
          <input
            ref={searchRef}
            className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted"
            placeholder="搜索标题、分类、风格，支持拼音首字母"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (setQ(""), e.currentTarget.blur())}
            data-testid="prompt-search"
            enterKeyHint="search"
          />
          <kbd className="hidden rounded border border-rule px-1.5 text-[10px] text-muted sm:inline">/</kbd>
        </label>
        <select className="chip cursor-pointer py-2 text-sm outline-none" value={sort} onChange={(e) => (setSort(e.target.value as SxSort), setSeed(Math.floor(Math.random() * 1e9)))} aria-label="排序">
          <option value="mix">推荐</option>
          <option value="hot">最热</option>
          <option value="new">最新</option>
          <option value="rand">随机</option>
        </select>
        {sort === "rand" && (
          <button className="chip py-2" onClick={() => setSeed(Math.floor(Math.random() * 1e9))} title="再随机一次">
            <Shuffle size={13} />
          </button>
        )}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" className="accent-[var(--acc)]" checked={full} onChange={(e) => setFull(e.target.checked)} />
          搜索正文{fullLoading && <Loader2 size={12} className="animate-spin" />}
        </label>
      </div>

      {/* 大类 */}
      {idx && (
        <div className="scroll-thin -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
          <button className={`chip shrink-0 px-2.5 py-1.5 text-[13px] ${major < 0 ? "chip-on" : ""}`} onClick={() => (setMajor(-1), setSub(-1))}>
            全部 <span className="opacity-60">{counts.total}</span>
          </button>
          {idx.majors.map(([n, color], i) =>
            counts.c.get(i) && (!hidden.has(i) || major === i) ? (
              <button key={n} className={`chip shrink-0 px-2.5 py-1.5 text-[13px] ${major === i ? "chip-on" : ""}`} onClick={() => (setMajor(i), setSub(-1))}>
                <span className="h-2 w-2 rounded-full" style={{ background: color || "var(--rule)" }} />
                {majorName(n)} <span className="opacity-60">{counts.c.get(i)}</span>
              </button>
            ) : null,
          )}
        </div>
      )}
      {subs.length > 1 && (
        <div className="scroll-thin -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap">
          <button className={`chip shrink-0 ${sub < 0 ? "chip-on" : ""}`} onClick={() => setSub(-1)}>
            全部
          </button>
          {subs.map(([s, i]) => (
            <button key={s[0]} className={`chip shrink-0 ${sub === i ? "chip-on" : ""}`} onClick={() => setSub(i)}>
              {subName(s[0])} <span className="opacity-60">{counts.cs.get(i)}</span>
            </button>
          ))}
        </div>
      )}
      {idx && !!idx.hot.length && (
        <div className="scroll-thin -mx-1 mt-2 flex items-center gap-1.5 overflow-x-auto px-1 pb-1">
          <Flame size={13} className="shrink-0 text-warn" />
          {idx.hot.map((t) => (
            <button key={t} className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${dq === t.toLowerCase() ? "bg-acc/15 text-acc-ink" : "text-muted hover:bg-hover hover:text-ink"}`} onClick={() => setQ(dq === t.toLowerCase() ? "" : t)}>
              #{t}
            </button>
          ))}
        </div>
      )}

      {/* 今日推荐 */}
      {idx && major < 0 && !dq && picks.length > 0 && (
        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">今日推荐</h2>
            <button className="btn-ghost btn-sm" onClick={() => setPick((x) => x + 1)}>
              <RefreshCw size={12} /> 换一批
            </button>
          </div>
          <div className="scroll-thin -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1">
            {picks.map((i) => {
              const r = idx.rows[i];
              const color = idx.majors[idx.subs[r[2]][1]][1] || "#7c5cff";
              return (
                <button
                  key={r[0]}
                  onClick={() => openAt(i)}
                  onPointerEnter={() => warm(i)}
                  className="group relative h-36 w-28 shrink-0 overflow-hidden rounded-xl text-left sm:h-40 sm:w-32"
                  style={{ background: `linear-gradient(140deg, ${color}33, ${color}99)` }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={coverUrl(manifest, r[3], 360, prefs.cover)} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-105" />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-6 text-[11px] leading-snug text-white">
                    <span className="line-clamp-2">{r[1]}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="mb-2 mt-4 text-xs text-muted" aria-live="polite">
        {idx ? `${view.length} 条${full && fullLoading ? " · 正在加载正文…" : ""}${needPy && !pyHay ? " · 正在加载拼音…" : ""}` : "正在加载提示词库…"}
      </div>

      {!idx ? (
        <Skeleton />
      ) : !view.length ? (
        <div className="card px-6 py-14 text-center text-sm text-muted">
          没有匹配的提示词，换个关键词试试{!full && dq ? "，或勾选「搜索正文」" : ""}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-testid="prompt-grid">
            {view.slice(0, shown).map((i) => {
              const r = idx.rows[i];
              return (
                <Card
                  key={r[0]}
                  i={i}
                  id={r[0]}
                  title={r[1]}
                  sub={subName(idx.subs[r[2]][0])}
                  likes={r[4]}
                  nImg={r[5]}
                  cover={coverUrl(manifest, r[3], 360, prefs.cover)}
                  color={idx.majors[idx.subs[r[2]][1]][1]}
                  fav={favs.has("sx:" + r[0])}
                  onOpen={openAt}
                  onWarm={warm}
                />
              );
            })}
          </div>
          <div ref={moreRef} className="py-6 text-center text-xs text-muted">
            {shown < view.length ? (
              <button className="btn-ghost btn-sm" onClick={() => setShown((s) => s + BATCH)}>
                显示更多（已显示 {shown} / {view.length}）
              </button>
            ) : (
              "— 到底了 —"
            )}
          </div>
        </>
      )}

      {entry && (
        <PromptDrawer
          entry={entry}
          onClose={() => setOpen(null)}
          onPrev={pos > 0 ? () => openAt(view[pos - 1]) : undefined}
          onNext={pos >= 0 && pos < view.length - 1 ? () => openAt(view[pos + 1]) : undefined}
          onSaveAsMine={(text) => onSaveAsMine({ title: entry.title, prompt: text, ratio: entry.ratio })}
        />
      )}
    </div>
  );
}
