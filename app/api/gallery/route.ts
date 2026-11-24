import { guard } from "@/lib/server/auth";
import { listGallery } from "@/lib/server/store";
import { withDb } from "@/lib/server/dbguard";

export const dynamic = "force-dynamic";

/**
 * 图库列表。可选参数（画图页只要图片、一次只要一页，响应小很多）：
 *   kind=image|video  只要图片或视频
 *   offset、limit     分页；带了 limit 时同时返回 total
 */
async function GETHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const sp = new URL(req.url).searchParams;
  let items = await listGallery();
  const kind = sp.get("kind");
  if (kind === "image") items = items.filter((x) => x.kind !== "video");
  else if (kind === "video") items = items.filter((x) => x.kind === "video");
  if (!sp.has("limit")) return Response.json({ items });
  const offset = Math.max(0, Number(sp.get("offset")) || 0);
  const limit = Math.min(200, Math.max(1, Number(sp.get("limit")) || 60));
  return Response.json({ items: items.slice(offset, offset + limit), total: items.length });
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const GET = withDb(GETHandler);
