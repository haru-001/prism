import { guard } from "@/lib/server/auth";
import { bad, readJSON } from "@/lib/server/api";
import { getPromptDoc, savePromptDoc } from "@/lib/server/prompts";
import { withDb } from "@/lib/server/dbguard";

export const dynamic = "force-dynamic";

/** 我的提示词 + 收藏 */
async function GETHandler() {
  const g = await guard();
  if (g) return g;
  return Response.json(await getPromptDoc(), { headers: { "Cache-Control": "no-store" } });
}

/** body: { items?: UserPrompt[] } 或 { favs?: SavedPrompt[] }，各自整体替换 */
async function PUTHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const b = await readJSON<{ items?: unknown; favs?: unknown }>(req);
  if (!b || (b.items === undefined && b.favs === undefined)) return bad("没有要保存的内容");
  if ((b.items !== undefined && !Array.isArray(b.items)) || (b.favs !== undefined && !Array.isArray(b.favs))) return bad("items / favs 必须是数组");
  return Response.json(await savePromptDoc(b));
}

export const GET = withDb(GETHandler);
export const PUT = withDb(PUTHandler);
