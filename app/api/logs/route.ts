import { guard } from "@/lib/server/auth";
import { clearLogs, listLogs } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guard();
  if (g) return g;
  return Response.json({ logs: await listLogs() });
}

export async function DELETE() {
  const g = await guard();
  if (g) return g;
  await clearLogs();
  return Response.json({ ok: true });
}
