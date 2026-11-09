import { handleGemini, preflight, cors } from "@/lib/server/relay/inbound";
import { geminiError } from "@/lib/server/relay/formats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** /v1beta/models/{model}:generateContent 或 :streamGenerateContent */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  const tail = decodeURIComponent(slug.join("/"));
  const i = tail.lastIndexOf(":");
  if (i < 0) return cors(geminiError(404, "路径应为 /v1beta/models/{model}:generateContent"));
  return handleGemini(req, tail.slice(0, i), tail.slice(i + 1));
}

export const OPTIONS = preflight;
