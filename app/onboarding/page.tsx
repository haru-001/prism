import { redirect } from "next/navigation";
import { isAuthed, passwordConfigured } from "@/lib/server/auth";
import { env, setupProblems } from "@/lib/server/env";
import { getSettings, listChannels } from "@/lib/server/store";
import { callName } from "@/lib/copy";
import { SetupProblems } from "@/components/SetupProblems";
import { Onboarding } from "@/components/Onboarding";
import { DbSleeping } from "@/components/DbLazy";
import { isDbDown } from "@/lib/server/mysql";

export const dynamic = "force-dynamic";
export const metadata = { title: "欢迎来到 Prism" };

export default async function OnboardingPage() {
  const problems = setupProblems();
  if (problems.length) return <SetupProblems problems={problems} />;
  let configured: boolean;
  let authed: boolean;
  let channels: Awaited<ReturnType<typeof listChannels>> = [];
  let settings: Awaited<ReturnType<typeof getSettings>> | null = null;
  try {
    configured = await passwordConfigured();
    authed = await isAuthed();
    if (authed) [channels, settings] = await Promise.all([listChannels(), getSettings()]);
  } catch (e) {
    // 数据库连不上：显示「数据库睡着了」，不白屏
    if (isDbDown(e)) return <DbSleeping kind={e.kind} />;
    throw e;
  }
  // 密码已经设过但没登录：先登录，登录后会回到这里
  if (configured && !authed) redirect("/login");
  return (
    <Onboarding
      passwordMode={env.accessPassword ? "env" : configured ? "set" : "none"}
      channelCount={channels.length}
      name={settings ? callName(settings.callMode, settings.customName) : "你"}
    />
  );
}
