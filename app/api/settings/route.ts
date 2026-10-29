import { guard } from "@/lib/server/auth";
import { getSettings, saveSettings } from "@/lib/server/store";
import { bad, readJSON } from "@/lib/server/api";
import type { Settings } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guard();
  if (g) return g;
  return Response.json({ settings: await getSettings() });
}

export async function PUT(req: Request) {
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
  if (b.temperature != null && Number.isFinite(Number(b.temperature))) patch.temperature = Math.min(2, Math.max(0, Number(b.temperature)));
  return Response.json({ settings: await saveSettings(patch) });
}
