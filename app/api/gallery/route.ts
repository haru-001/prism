import { guard } from "@/lib/server/auth";
import { listGallery } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guard();
  if (g) return g;
  return Response.json({ items: await listGallery() });
}
