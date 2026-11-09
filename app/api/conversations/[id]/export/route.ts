import { guard } from "@/lib/server/auth";
import { bad } from "@/lib/server/api";
import { getConversation } from "@/lib/server/store";
import { publicOrigin } from "@/lib/server/imgurl";
import { conversationToJSON, conversationToMarkdown, exportFileName } from "@/lib/exportConv";
import { withDb } from "@/lib/server/dbguard";

export const dynamic = "force-dynamic";

/** 导出对话：?format=md（默认）或 json，直接下载 */
async function GETHandler(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g) return g;
  const { id } = await ctx.params;
  const c = await getConversation(id);
  if (!c) return bad("对话不存在", 404);
  const url = new URL(req.url);
  const fmt = url.searchParams.get("format") === "json" ? "json" : "md";
  const origin = publicOrigin(req);
  const body = fmt === "json" ? conversationToJSON(c) : conversationToMarkdown(c, origin);
  const name = exportFileName(c, fmt);
  return new Response(body, {
    headers: {
      "Content-Type": fmt === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="prism-${fmt}.${fmt}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const GET = withDb(GETHandler);
