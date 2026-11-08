"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { RinneFigure } from "./RinneFigure";
import { useRinne } from "./RinneProvider";

const OFF_KEY = "rinne-peek-off";
const IDLE_MS = 45_000;
const TIPS = [
  "输入 /图 加描述，可以直接生图。",
  "输入 /视频 加描述，可以生成一段短视频。",
  "点顶部的模型名，可以随时换模型。",
  "Shift + Enter 换行，Enter 发送。",
  "可以把图片拖进输入框，让支持识图的模型来看。",
  "常用的系统提示可以存成预设，下次一键套用。",
];

/**
 * 输入框探头提示：输入框空着、一段时间没操作时，棱音从输入框右上沿探出半身给一句提示。
 * 点 × 本次关掉；「不再提示」写进 localStorage。「显示棱音」关掉或正在输出时不出现。
 */
export function RinnePeek({ input, busy }: { input: string; busy: boolean }) {
  const { show, animate } = useRinne();
  const [visible, setVisible] = useState(false);
  const [off, setOff] = useState(true);
  const [tip, setTip] = useState(0);

  useEffect(() => {
    setOff(localStorage.getItem(OFF_KEY) === "1");
  }, []);

  useEffect(() => {
    setVisible(false);
    if (off || !show || busy || input.trim()) return;
    const t = setTimeout(() => {
      setTip((i) => (i + 1) % TIPS.length);
      setVisible(true);
    }, Number((globalThis as { __RINNE_PEEK_MS?: number }).__RINNE_PEEK_MS) || IDLE_MS);
    return () => clearTimeout(t);
  }, [input, busy, show, off]);

  if (!visible) return null;
  return (
    <div className="rn-peek" data-anim={animate ? "1" : "0"} data-testid="rinne-peek">
      <div className="rn-peek-tip">
        <div className="flex items-start gap-1.5">
          <span className="flex-1">{TIPS[tip]}</span>
          <button className="shrink-0 text-muted hover:text-ink" aria-label="关闭提示" onClick={() => setVisible(false)}>
            <X size={13} />
          </button>
        </div>
        <button
          className="mt-1 text-[11px] text-muted underline-offset-2 hover:underline"
          onClick={() => {
            localStorage.setItem(OFF_KEY, "1");
            setOff(true);
          }}
        >
          不再提示
        </button>
      </div>
      <RinneFigure mood="guide" size="bar" standalone className="rn-bar-fig rn-peek-fig" />
    </div>
  );
}
