import { guard } from "@/lib/server/auth";
import { listChannels } from "@/lib/server/store";
import { buildCatalog } from "@/lib/server/relay/router";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guard();
  if (g) return g;
  return Response.json({ catalog: buildCatalog(await listChannels()) });
}
