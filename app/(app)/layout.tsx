import { redirect } from "next/navigation";
import { isAuthed, passwordConfigured } from "@/lib/server/auth";
import { setupProblems } from "@/lib/server/env";
import { loadBoot } from "@/lib/server/boot";
import { listConversations } from "@/lib/server/store";
import { AppProvider } from "@/components/AppContext";
import { Sidebar } from "@/components/Sidebar";
import { Toaster } from "@/components/ui";
import { SetupProblems } from "@/components/SetupProblems";
import { DbSleeping } from "@/components/DbLazy";
import { DbQuotaGate } from "@/components/DbQuotaGate";
import { isDbDown } from "@/lib/server/mysql";
import { refreshDbSnapshotLater } from "@/lib/server/dbstats";
import { cookies } from "next/headers";
import { RINNE_COOKIE, parsePrefs } from "@/lib/rinne";
import { RinneAppRoot } from "@/components/rinne/RinneRoot";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const problems = setupProblems();
  if (problems.length) return <SetupProblems problems={problems} />;
  let go: string | null = null;
  let boot: Awaited<ReturnType<typeof loadBoot>>;
  let ob: Awaited<ReturnType<typeof loadBoot>>["onboarding"];
  try {
    // 登录态和启动配置都走内存缓存，冷启动时也合成一条 SQL；两者并行
    const [authed, b] = await Promise.all([isAuthed(), loadBoot()]);
    boot = b;
    ob = boot.onboarding;
    if (!authed) go = (await passwordConfigured()) ? "/login" : "/onboarding";
    // 缓存里显示没走完引导时，直接读库确认一次（可能刚在别的实例上走完）
    else if (!ob.completed) ob = (await loadBoot({ fresh: true })).onboarding;
  } catch (e) {
    // 数据库连不上（比如 Aiven 免费档被关机）：显示「数据库睡着了」，不白屏
    if (isDbDown(e)) return <DbSleeping kind={e.kind} />;
    throw e;
  }
  if (go) redirect(go);
  if (!ob.completed) redirect("/onboarding");
  // 数据库容量快照过期了就在响应发出后顺手量一次（最多 6 小时一次，只查 information_schema）
  refreshDbSnapshotLater(boot.db);
  // 会话列表不等：页面先发下去，列表读完后随同一个响应流式补上
  const conversations = listConversations();
  conversations.catch(() => {});
  const rinne = parsePrefs((await cookies()).get(RINNE_COOKIE)?.value);
  return (
    <AppProvider initialBoot={{ ...boot, onboarding: ob }} initialConversations={conversations}>
      <RinneAppRoot cookie={rinne}>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
          <DbQuotaGate />
        </main>
      </div>
      <Toaster />
      </RinneAppRoot>
    </AppProvider>
  );
}
