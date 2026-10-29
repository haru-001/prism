import { guard } from "@/lib/server/auth";
import { env, setupProblems } from "@/lib/server/env";
import { storageKind } from "@/lib/server/kv";
import { getOnboarding, getSettings, listChannels } from "@/lib/server/store";
import { buildCatalog } from "@/lib/server/relay/router";
import { toPublic } from "@/lib/server/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guard();
  if (g) return g;
  const [settings, onboarding, channels] = await Promise.all([getSettings(), getOnboarding(), listChannels()]);
  return Response.json({
    settings,
    onboarding,
    channels: channels.map(toPublic),
    catalog: buildCatalog(channels),
    flags: {
      envPassword: !!env.accessPassword,
      envToken: !!env.apiToken,
      storage: storageKind(),
      blob: !!env.blobToken,
      problems: setupProblems(),
    },
  });
}
