import type { Conversation } from "./types";

/** 对话导出：Markdown（给人看）和 JSON（完整数据，可导入其他工具） */

function fmtTime(ts: number) {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function exportFileName(c: Conversation, ext: "md" | "json") {
  const safe = (c.title || "对话").replace(/[\\/:*?"<>|\r\n]+/g, " ").trim().slice(0, 40) || "对话";
  return `${safe}.${ext}`;
}

/** origin：把 /api/files/... 这类站内图片地址补成完整链接 */
export function conversationToMarkdown(c: Conversation, origin = ""): string {
  const abs = (u: string) => (u.startsWith("/") ? origin + u : u);
  const out: string[] = [`# ${c.title || "新对话"}`, ""];
  const meta = [`创建于 ${fmtTime(c.createdAt)}`, `更新于 ${fmtTime(c.updatedAt)}`];
  if (c.model) meta.push(`模型 ${c.model}`);
  out.push(`> ${meta.join(" · ")}`, "");
  if (c.system?.trim()) out.push("**系统提示词**", "", "```", c.system.trim(), "```", "");
  for (const m of c.messages) {
    if (m.pending) continue;
    if (m.role === "notice") {
      out.push(`> 棱音：${m.text}`, "");
      continue;
    }
    if (m.role === "user") {
      out.push(`## 你${m.mode === "image" ? "（生图）" : ""}`, "");
    } else {
      const tag = m.group ? (m.alt ? "（并排回答）" : "（并排回答 · 已选用）") : "";
      const via = [m.model, m.channel].filter(Boolean).join(" · ");
      out.push(`## ${via || "助手"}${tag}`, "");
    }
    if (m.reasoning?.trim()) out.push("<details><summary>思考过程</summary>", "", m.reasoning.trim(), "", "</details>", "");
    if (m.text) out.push(m.text, "");
    for (const u of m.images || []) out.push(`![](${abs(u)})`, "");
    if (m.error) out.push(`> 出错：${m.error.title}。${m.error.message}`, "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function conversationToJSON(c: Conversation): string {
  const messages = c.messages
    .filter((m) => !m.pending)
    .map((m) => {
      const o: Record<string, unknown> = { role: m.role, text: m.text, createdAt: m.createdAt };
      if (m.mode === "image") o.mode = "image";
      if (m.images?.length) o.images = m.images;
      if (m.model) o.model = m.model;
      if (m.channel) o.channel = m.channel;
      if (m.reasoning) o.reasoning = m.reasoning;
      if (m.usage) o.usage = m.usage;
      if (m.group) {
        o.group = m.group;
        o.chosen = !m.alt;
      }
      if (m.error) o.error = m.error;
      return o;
    });
  return JSON.stringify(
    {
      format: "prism-conversation",
      version: 1,
      exportedAt: new Date().toISOString(),
      id: c.id,
      title: c.title,
      model: c.model,
      system: c.system || "",
      temperature: c.temperature,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messages,
    },
    null,
    2,
  );
}
