import type { Metadata, Viewport } from "next";
import "highlight.js/styles/github-dark.css";
import "./globals.css";
import "@/components/rinne/rinne.css";
import { cookies } from "next/headers";
import { RINNE_COOKIE, parsePrefs } from "@/lib/rinne";
import { RinneCookieRoot } from "@/components/rinne/RinneRoot";
import { DbDownWatcher } from "@/components/DbLazy";

export const metadata: Metadata = {
  title: "Prism · 棱音的 AI 工作台",
  description: "个人用的大模型聚合网关：对话、生图、多渠道故障转移，兼容 OpenAI / Claude / Gemini 接口。",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0e17" },
  ],
};

// 在首帧前应用主题，避免闪烁
const themeScript = `(function(){try{var t=localStorage.getItem('prism-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})()`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 棱音的服装等形象设置：登录前只有 cookie，首屏直接出对的服装
  const rinne = parsePrefs((await cookies()).get(RINNE_COOKIE)?.value);
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <RinneCookieRoot cookie={rinne}>
          {children}
          <DbDownWatcher />
        </RinneCookieRoot>
      </body>
    </html>
  );
}
