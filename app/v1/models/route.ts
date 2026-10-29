import { handleModels, preflight } from "@/lib/server/relay/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleModels(req);
}
export const OPTIONS = preflight;
