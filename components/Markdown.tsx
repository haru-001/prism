"use client";

import { isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Copy } from "lucide-react";
import { copyText } from "./ui";

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

function MarkdownInner({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: Pre,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownInner);
