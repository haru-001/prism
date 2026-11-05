import { guard } from "@/lib/server/auth";
import { getSettings, saveSettings } from "@/lib/server/store";
import { bad, readJSON } from "@/lib/server/api";
import type { Settings } from "@/lib/types";
import { withDb } from "@/lib/server/dbguard";
import { isMotion, isOutfit } from "@/lib/rinne";

export const dynamic = "force-dynamic";

async function GETHandler() {
  const g = await guard();
  if (g) return g;
  return Response.json({ settings: await getSettings() });
}

async function PUTHandler(req: Request) {
  const g = await guard();
  if (g) return g;
  const b = await readJSON<Partial<Settings>>(req);
  if (!b) return bad("请求体不是合法 JSON");
  const patch: Partial<Settings> = {};
  if (b.callMode && ["you", "producer", "custom"].includes(b.callMode)) patch.callMode = b.callMode;
  if (typeof b.customName === "string") patch.customName = b.customName.slice(0, 20);
  if (typeof b.personaInModel === "boolean") patch.personaInModel = b.personaInModel;
  if (typeof b.defaultModel === "string") patch.defaultModel = b.defaultModel;
  if (typeof b.defaultImageModel === "string") patch.defaultImageModel = b.defaultImageModel;
  if (typeof b.defaultSystem === "string") patch.defaultSystem = b.defaultSystem.slice(0, 8000);
  if (isOutfit(b.rinneOutfit)) patch.rinneOutfit = b.rinneOutfit;
  if (isMotion(b.rinneMotion)) patch.rinneMotion = b.rinneMotion;
  if (typeof b.rinneShow === "boolean") patch.rinneShow = b.rinneShow;
  if (b.temperature != null && Number.isFinite(Number(b.temperature))) patch.temperature = Math.min(2, Math.max(0, Number(b.temperature)));
  return Response.json({ settings: await saveSettings(patch) });
}

// 数据库连不上时返回 503 和中文说明（前端据此显示「数据库睡着了」）
export const GET = withDb(GETHandler);
export const PUT = withDb(PUTHandler);
