import "server-only";
import { env, setupProblems } from "./env";
import { kv, P, storageKind } from "./kv";
import { getOnboarding, getSettings, listChannels } from "./store";
import { buildCatalog } from "./relay/router";
import { listPresets } from "./presets";
import { toPublic } from "./api";
import { getDbSnapshot, warnRatio } from "./dbstats";

/**
 * 页面启动需要的全部配置。热键都在内存缓存里，三个读取在冷启动时也只合成一条 SQL。
 * fresh=true：刚改完配置后刷新时用，直接读库（多实例时不会读到别的实例的旧缓存）。
 */
export async function loadBoot(opts?: { fresh?: boolean }) {
  // fresh：一条 SQL 把三个键直接从库里读回来并刷新缓存，下面的读取就都命中缓存了
  if (opts?.fresh) await kv().mget([P + "settings", P + "onboarding", P + "channels", P + "presets"], { fresh: true });
  const [settings, onboarding, channels, presets, db] = await Promise.all([getSettings(), getOnboarding(), listChannels(), listPresets(), getDbSnapshot()]);
  return {
    settings,
    onboarding,
    channels: channels.map(toPublic),
    catalog: buildCatalog(channels),
    presets,
    // 数据库容量快照（热键，跟着上面同一条 SQL 读出来）：快满时棱音提醒
    db: db ? { ...db, ratio: db.usedBytes / db.quotaBytes, warnRatio: warnRatio() } : null,
    flags: {
      envPassword: !!env.accessPassword,
      envToken: !!env.apiToken,
      storage: storageKind(),
      blob: !!env.blobToken,
      problems: setupProblems(),
    },
  };
}
export type BootData = Awaited<ReturnType<typeof loadBoot>>;
