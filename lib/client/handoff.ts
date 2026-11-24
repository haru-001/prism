"use client";

/** 页面之间带内容：提示词库 →「用这个画」→ 画图页；画图页 / 提示词库 →「发到对话」→ 新对话。存在 sessionStorage，取一次就清掉 */

// ===== 送去画图 / 对话 =====
export interface DrawDraft {
  prompt: string;
  /** 建议比例，如 2:3；画图页按当前模型换成最接近的尺寸 */
  ratio?: string;
  /** 来自哪条提示词（my:xxx 时画完把图设成封面） */
  key?: string;
  refs?: string[];
  model?: string;
  size?: string;
  n?: number;
  quality?: string;
  time: number;
}
const DRAW_KEY = "prism-draw-draft";
const CHAT_KEY = "prism-chat-draft";
export function setDrawDraft(d: Omit<DrawDraft, "time">) {
  try {
    sessionStorage.setItem(DRAW_KEY, JSON.stringify({ ...d, time: Date.now() }));
  } catch {
    /* 忽略 */
  }
}
/** 取出并清掉（10 分钟内有效） */
export function takeDrawDraft(): DrawDraft | null {
  try {
    const s = sessionStorage.getItem(DRAW_KEY);
    sessionStorage.removeItem(DRAW_KEY);
    const d = s ? (JSON.parse(s) as DrawDraft) : null;
    return d && Date.now() - d.time < 600_000 ? d : null;
  } catch {
    return null;
  }
}
export interface ChatDraft {
  text: string;
  mode: "chat" | "image";
  /** 对话模式附带的图片 / 生图模式的参考图 */
  images?: string[];
  time: number;
}
export function setChatDraft(d: Omit<ChatDraft, "time">) {
  try {
    sessionStorage.setItem(CHAT_KEY, JSON.stringify({ ...d, time: Date.now() }));
  } catch {
    /* 忽略 */
  }
}
export function takeChatDraft(): ChatDraft | null {
  try {
    const s = sessionStorage.getItem(CHAT_KEY);
    if (!s) return null;
    sessionStorage.removeItem(CHAT_KEY);
    const d = JSON.parse(s) as ChatDraft;
    return Date.now() - d.time < 600_000 ? d : null;
  } catch {
    return null;
  }
}

