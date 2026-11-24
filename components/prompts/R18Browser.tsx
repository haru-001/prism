"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, Shuffle } from "lucide-react";
import { asExamples, r18Chunk, setPrefs, useLibPrefs, usePromptDoc } from "@/lib/client/promptlib";
import type { LibManifest } from "@/lib/prompts/types";
import { ASGEN } from "@/lib/prompts/asgen";
import { R18ZH } from "@/lib/prompts/r18zh";
import { PromptDrawer, type DrawerEntry } from "./PromptDrawer";

/**
 * R18 库（移植自 haru）：只在确认已满 18 岁后由提示词页按需加载（这个组件和词表都是单独的代码块）。
 * - 亚洲写真：上游精选范例 + 本地中英双语组合库（2400 条）
 * - 英文精选：stablellama/erotic-image-prompts 里筛出的 3000 条，按需分块加载
 */

const NUD = ["着装", "半裸", "全裸"];
const NAMES = /\b(Alice|Bella|Clara|Diana|Emma|Adam|Bob|Charlie|David|Eric)\b/g;
const BATCH = 48;

interface Item {
  key: string;
  src: "r18" | "as";
  en: string;
  zh: string;
  title: string;
  nud: number;
  ratio: string;
  cat?: string;
  ex?: boolean;
  neg?: string;
  pts: string[];
  cloth?: string[];
  ppl?: [number, number];
  hay: string;
}

type Gen = { en: string; zh: string; title: string; nud: number; ratio: string; cat: string; pts: string[]; neg: string };
type Pt = { zh: string };
const AS = ASGEN as unknown as { make: (i: number) => Gen; CATS: string[]; COUNT: number; NEG: string };
const ZH = R18ZH as unknown as {
  points: (t: string, n?: number) => Pt[];
  zhPrompt: (r: unknown[], clothZh: (t: string) => string) => string;
};

export default function R18Browser({ manifest, scrollRef }: { manifest: LibManifest; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const prefs = useLibPrefs();
  const { doc } = usePromptDoc();
  const rs = prefs.rs;
  const [asItems, setAsItems] = useState<Item[] | null>(null);
  const [stItems, setStItems] = useState<Item[]>([]);
  const [stDone, setStDone] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim().toLowerCase());
  const [nud, setNud] = useState(-1);
  const [ppl, setPpl] = useState(0);
  const [cat, setCat] = useState("");
  const [rand, setRand] = useState(0);
  const [shown, setShown] = useState(BATCH);
  const [open, setOpen] = useState<string | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const clothZh = (t: string) => manifest.r18.clothZh[t] || t;

  // 亚洲写真：精选范例（12KB）+ 本地组合
  useEffect(() => {
    if (rs !== "as" || asItems) return;
    let alive = true;
    asExamples(manifest)
      .catch(() => [])
      .then((ex) => {
        if (!alive) return;
        const out: Item[] = [];
        for (const x of ex) {
          out.push({
            key: "as:e" + x[6],
            src: "as",
            en: x[0],
            nud: x[1],
            ratio: x[2],
            title: x[3],
            zh: x[4] || "",
            cat: x[5],
            ex: true,
            pts: ZH.points(x[0]).map((p) => p.zh),
            hay: `${x[0]} ${x[3]} ${x[4]} ${x[5]} 精选`.toLowerCase(),
          });
        }
        for (let i = 0; i < AS.COUNT; i++) {
          const g = AS.make(i);
          out.push({ key: "as:g" + i, src: "as", en: g.en, zh: g.zh, title: g.title, nud: g.nud, ratio: g.ratio, cat: g.cat, neg: g.neg, pts: g.pts, hay: `${g.en} ${g.zh} ${g.title}`.toLowerCase() });
        }
        setAsItems(out);
      });
    return () => {
      alive = false;
    };
  }, [rs, asItems, manifest]);

  // 英文精选：先拿第一块显示，其余分块在后台陆续加载（切到亚洲写真也不打断）
  const stStarted = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (rs !== "st" || stStarted.current) return;
    stStarted.current = true;
    (async () => {
      try {
        for (let n = 0; n < manifest.r18.chunks; n++) {
          const c = await r18Chunk(manifest, n);
          if (!alive.current) return;
          const add: Item[] = c.map((r) => {
            const pts = ZH.points(r[0]).map((p) => p.zh);
            return {
              key: "r18:" + r[6],
              src: "r18",
              en: r[0],
              zh: ZH.zhPrompt(r as unknown[], clothZh),
              title: pts.slice(0, 5).join(" · ") || r[0].slice(0, 48) + "…",
              nud: r[1],
              ratio: r[2],
              ppl: [r[3], r[4]],
              cloth: r[5],
              pts,
              hay: `${r[0]} ${pts.join(" ")} ${r[5].map(clothZh).join(" ")}`.toLowerCase(),
            };
          });
          setStItems((l) => l.concat(add));
        }
        if (alive.current) setStDone(true);
      } catch (e) {
        stStarted.current = false;
        if (alive.current) setErr((e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rs, manifest]);

  const items = rs === "as" ? asItems || [] : stItems;
  const loading = rs === "as" ? !asItems : !stDone;
  const view = useMemo(() => {
    const words = dq.split(/\s+/).filter(Boolean);
    const out = items.filter(
      (x) =>
        (nud < 0 || x.nud === nud) &&
        (rs !== "st" || !ppl || (ppl === 1 ? x.ppl![0] + x.ppl![1] === 1 : x.ppl![0] + x.ppl![1] >= 2)) &&
        (rs !== "as" || !cat || (cat === "精选" ? x.ex : x.cat === cat)) &&
        (!words.length || words.every((w) => x.hay.includes(w))),
    );
    if (rand) {
      let s = rand;
      for (let i = out.length - 1; i > 0; i--) {
        s = (s * 9301 + 49297) % 233280;
        const j = Math.floor((s / 233280) * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
    }
    return out;
  }, [items, dq, nud, ppl, cat, rs, rand]);

  useEffect(() => {
    setShown(BATCH);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [dq, nud, ppl, cat, rs, rand, scrollRef]);
  useEffect(() => {
    const el = moreRef.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setShown((s) => s + BATCH), { root: scrollRef.current, rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [view.length, shown, scrollRef]);

  const favs = useMemo(() => new Set(doc.favs.map((f) => f.key)), [doc.favs]);
  const cats = useMemo(() => {
    const c: Record<string, number> = {};
    for (const x of asItems || []) {
      c[x.cat || ""] = (c[x.cat || ""] || 0) + 1;
      if (x.ex) c["精选"] = (c["精选"] || 0) + 1;
    }
    return c;
  }, [asItems]);

  const pos = open ? view.findIndex((x) => x.key === open) : -1;
  const cur = pos >= 0 ? view[pos] : null;
  const entry: DrawerEntry | null = cur
    ? (() => {
        // 英文版里的人物占位名（Alice、Bob…）当作变量：可以换成角色名或 LoRA 触发词
        const en = cur.en.replace(NAMES, (n) => `{argument name="${n}" default="${n}"}`);
        const zhL = { label: "中文", text: cur.zh, tip: "中文版适合即梦、豆包 Seedream、可图、通义万相、Qwen-Image 等中文模型。" };
        const enL = { label: "English", text: en, tip: "英文原文细节最全，适合 FLUX、SDXL 写实、Pony 等。" };
        const langs = cur.zh ? (prefs.r18zh ? [zhL, enL] : [enL, zhL]) : [enL];
        return {
          key: cur.key,
          src: cur.src,
          title: cur.title,
          crumb: cur.src === "as" ? `R18 / 亚洲写真 / ${cur.cat}` : `R18 / ${NUD[cur.nud]} / ${cur.ppl![0] + cur.ppl![1]} 人`,
          text: langs[0].text,
          langs,
          ratio: cur.ratio,
          points: cur.pts,
          badges: [
            { text: NUD[cur.nud], acc: true },
            { text: `建议比例 ${cur.ratio}` },
            ...(cur.cat ? [{ text: cur.cat }] : []),
            ...(cur.ex ? [{ text: "上游精选" }] : []),
            ...(cur.ppl ? [{ text: `女 ${cur.ppl[1]} · 男 ${cur.ppl[0]}` }] : []),
            ...(cur.cloth || []).map((c) => ({ text: clothZh(c) })),
          ],
          note: cur.src === "as" ? <>建议反向提示词：<code className="break-all">{cur.neg || AS.NEG}</code></> : undefined,
        } satisfies DrawerEntry;
      })()
    : null;

  return (
    <div>
      <div className="mb-3 rounded-xl border border-bad/30 bg-bad/5 px-3 py-2 text-xs leading-relaxed text-ink/80">
        成人内容，仅限已满 18 岁的你自己使用。人物一律为成年人；不含未成年、校园、偷拍、非自愿等题材。请遵守所用模型和平台的内容规范。
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-rule p-0.5 text-sm">
          {(
            [
              ["as", "亚洲写真"],
              ["st", "英文精选"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={`rounded-lg px-3 py-1 ${rs === k ? "bg-soft font-semibold text-acc-ink" : "text-muted"}`} onClick={() => (setPrefs({ rs: k }), setCat(""))}>
              {l}
            </button>
          ))}
        </div>
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-rule bg-card px-3 py-2 sm:max-w-sm">
          <Search size={15} className="text-muted" />
          <input className="w-full bg-transparent text-sm outline-none placeholder:text-muted" placeholder="中英文都能搜，如 浴缸 / 蕾丝 / 逆光 / lingerie" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button className={`chip py-2 ${rand ? "chip-on" : ""}`} onClick={() => setRand(Math.floor(Math.random() * 233280) + 1)} title="随机排序">
          <Shuffle size={13} /> 随机
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {[-1, 0, 1, 2].map((n) => (
          <button key={n} className={`chip ${nud === n ? "chip-on" : ""}`} onClick={() => setNud(n)}>
            {n < 0 ? "全部" : NUD[n]}
          </button>
        ))}
        {rs === "st" &&
          (
            [
              [0, "不限人数"],
              [1, "单人"],
              [2, "多人"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={`chip ${ppl === k ? "chip-on" : ""}`} onClick={() => setPpl(k)}>
              {l}
            </button>
          ))}
      </div>
      {rs === "as" && asItems && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[["", "全部", asItems.length] as const, ...(cats["精选"] ? [["精选", "精选范例", cats["精选"]] as const] : []), ...AS.CATS.map((c) => [c, c, cats[c] || 0] as const)].map(([v, l, n]) => (
            <button key={v || "all"} className={`chip ${cat === v ? "chip-on" : ""}`} onClick={() => setCat(v)}>
              {l} <span className="opacity-60">{n}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mb-2 mt-3 text-xs text-muted">
        {view.length} 条{loading && " · 加载中…"}
        {err && <span className="text-bad"> · {err}</span>}
      </div>
      {loading && !items.length ? (
        <div className="flex justify-center py-16 text-muted">
          <Loader2 className="animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {view.slice(0, shown).map((x) => (
              <button key={x.key} className="card flex flex-col p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md" onClick={() => setOpen(x.key)}>
                <div className="line-clamp-1 text-[13px] font-semibold">{x.title}</div>
                <p className="mt-1 line-clamp-4 text-xs leading-relaxed text-muted">{x.src === "as" ? x.zh : x.en}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="rounded bg-acc/15 px-1.5 py-0.5 text-[10px] text-acc-ink">{NUD[x.nud]}</span>
                  <span className="rounded bg-soft px-1.5 py-0.5 text-[10px] text-muted">{x.ratio}</span>
                  {x.cat && <span className="rounded bg-soft px-1.5 py-0.5 text-[10px] text-muted">{x.cat}</span>}
                  {(x.cloth || []).slice(0, 3).map((c) => (
                    <span key={c} className="rounded bg-soft px-1.5 py-0.5 text-[10px] text-muted">
                      {clothZh(c)}
                    </span>
                  ))}
                  {favs.has(x.key) && <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">已收藏</span>}
                </div>
              </button>
            ))}
          </div>
          <div ref={moreRef} className="py-6 text-center text-xs text-muted">
            {shown < view.length ? (
              <button className="btn-ghost btn-sm" onClick={() => setShown((s) => s + BATCH)}>
                显示更多（已显示 {shown} / {view.length}）
              </button>
            ) : view.length ? (
              "— 到底了 —"
            ) : (
              "没有匹配的提示词"
            )}
          </div>
        </>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        数据来源：
        <a className="underline" href="https://huggingface.co/datasets/stablellama/erotic-image-prompts" target="_blank" rel="noopener noreferrer">
          stablellama/erotic-image-prompts
        </a>
        （CC BY 4.0，已剔除任何未成年相关描写）；
        <a className="underline" href="https://github.com/ShuaiHui/nsfw-prompt-templates-asian" target="_blank" rel="noopener noreferrer">
          ShuaiHui/nsfw-prompt-templates-asian
        </a>
        （MIT）；组合库与中文要点来自 haru。
      </p>
      {entry && (
        <PromptDrawer
          entry={entry}
          onClose={() => setOpen(null)}
          onPrev={pos > 0 ? () => setOpen(view[pos - 1].key) : undefined}
          onNext={pos < view.length - 1 ? () => setOpen(view[pos + 1].key) : undefined}
        />
      )}
    </div>
  );
}
