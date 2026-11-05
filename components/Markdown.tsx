"use client";

import { isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Copy } from "lucide-react";
import { copyText } from "./ui";
import { imgSrc } from "@/lib/client/thumb";

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

function Pre({ children }: { children?: ReactNode }) {
  const child = Array.isArray(children) ? children[0] : children;
  const cls = isValidElement(child) ? String((child.props as { className?: string }).className || "") : "";
  const lang = /language-([\w+-]+)/.exec(cls)?.[1] || "text";
  const code = textOf(children).replace(/\n$/, "");
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-white/5">
      <div className="flex items-center justify-between bg-[#1d1a29] px-3 py-1.5 text-[11px] text-white/60">
        <span className="font-mono">{lang}</span>
        <button className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-white" onClick={() => copyText(code, "代码已复制")}>
          <Copy size={12} /> 复制
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

const PLUGINS_REMARK = [remarkGfm];
const PLUGINS_REHYPE: NonNullable<Parameters<typeof ReactMarkdown>[0]["rehypePlugins"]> = [[rehypeHighlight, { detect: true, ignoreMissing: true }]];
const COMPONENTS: NonNullable<Parameters<typeof ReactMarkdown>[0]["components"]> = {
  pre: Pre,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  // 模型回答里的图片（![](https://...)）经本站转发，不让浏览器直连外部域名
  img: ({ src, alt }) =>
    typeof src === "string" && src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imgSrc(src)} alt={alt || ""} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
    ) : null,
};

const Block = memo(function Block({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={PLUGINS_REMARK} rehypePlugins={PLUGINS_REHYPE} components={COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
});

/**
 * 按「代码块之外的空行」把 Markdown 切成段。流式输出时前面写完的段不会再变，
 * 每段单独缓存渲染，新字只会让最后一段重新解析，长回答也不会越打越卡。
 */
export function splitBlocks(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m) {
      if (!fence) fence = m[1][0];
      else if (m[1][0] === fence) fence = null;
    }
    if (!fence && line.trim() === "" && cur.length && !/^\s*([-*+]|\d+\.)\s/.test(cur[cur.length - 1]) && !/^\s*\|/.test(cur[cur.length - 1])) {
      out.push(cur.join("\n"));
      cur = [];
      continue;
    }
    cur.push(line);
  }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

function MarkdownInner({ text, streaming }: { text: string; streaming?: boolean }) {
  if (streaming) {
    return (
      <div className="md">
        {splitBlocks(text).map((b, i) => (
          <Block key={i} text={b} />
        ))}
      </div>
    );
  }
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={PLUGINS_REMARK}
        rehypePlugins={PLUGINS_REHYPE}
        components={COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownInner);
