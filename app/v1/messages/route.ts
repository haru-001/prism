import { handleClaudeMessages, preflight } from "@/lib/server/relay/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = handleClaudeMessages;
export const OPTIONS = preflight;
