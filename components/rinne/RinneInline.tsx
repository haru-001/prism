"use client";

import type { Mood } from "@/lib/rinne";
import { RinneFigure } from "./RinneFigure";
import { useRinne } from "./RinneProvider";

/**
 * 对话里的小场景：内容在左，棱音半身（头顶到腰，150px 高）在右，上下居中。
 * 对话流里放 290px 的全身像太占地方、也和消息气泡比例不搭，所以对话里只用半身；
 * 全身留给登录、引导、空对话、数据库休眠这类有整块空间的页面。
 * 「显示棱音」关掉时只留内容。
 */
export function RinneInline({ mood, children, testId, clip }: { mood: Mood; children: React.ReactNode; testId?: string; clip?: import("./RinneClip").ClipId }) {
  const { show } = useRinne();
  if (!show)
    return (
      <div className="rn-plain" data-testid={testId} data-rinne="off">
        {children}
      </div>
    );
  return (
    <div className="rn-inl" data-testid={testId} data-rinne-scene={mood}>
      <div className="rn-inl-body">{children}</div>
      <RinneFigure mood={mood} size="chat" standalone className="rn-chat-fig" clip={clip} />
    </div>
  );
}
