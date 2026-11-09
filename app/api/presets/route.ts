import { guard } from "@/lib/server/auth";
import { bad, readJSON } from "@/lib/server/api";
import { listPresets, normalizePresets, savePresets } from "@/lib/server/presets";
import { withDb } from "@/lib/server/dbguard";

export const dynamic = "force-dynamic";

async function GETHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  // fresh=1：直接读库（顺带刷新本实例的缓存），多实例时不会拿到别的实例改之前的旧列表
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  return Response.json({ presets: await listPresets({ fresh }) });
}

/** 整份替换（增删改都在前端做完再整体保存，列表很小） */
async function PUTHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const b = await readJSON<{ presets: unknown }>(req);
  if (!b || !Array.isArray(b.presets)) return bad("presets 必须是数组");
  const presets = normalizePresets(b.presets);
  await savePresets(presets);
  return Response.json({ presets });
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const GET = withDb(GETHandler);
export const PUT = withDb(PUTHandler);
