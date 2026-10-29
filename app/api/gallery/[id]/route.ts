import { guard } from "@/lib/server/auth";
import { hideGallery } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** 从图库移除（对话里的图不受影响） */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g) return g;
  const { id } = await ctx.params;
  await hideGallery(id);
  return Response.json({ ok: true });
}
