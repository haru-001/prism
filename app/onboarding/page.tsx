import { redirect } from "next/navigation";
import { isAuthed, passwordConfigured } from "@/lib/server/auth";
import { env, setupProblems } from "@/lib/server/env";
import { getSettings, listChannels } from "@/lib/server/store";
import { callName } from "@/lib/copy";
import { SetupProblems } from "@/components/SetupProblems";
import { Onboarding } from "@/components/Onboarding";

export const dynamic = "force-dynamic";
export const metadata = { title: "欢迎来到 Prism" };

export default async function OnboardingPage() {
  const problems = setupProblems();
  if (problems.length) return <SetupProblems problems={problems} />;
  const configured = await passwordConfigured();
  const authed = await isAuthed();
  // 密码已经设过但没登录：先登录，登录后会回到这里
  if (configured && !authed) redirect("/login");
  const channels = authed ? await listChannels() : [];
  const settings = authed ? await getSettings() : null;
  return (
    <Onboarding
      passwordMode={env.accessPassword ? "env" : configured ? "set" : "none"}
      channelCount={channels.length}
      name={settings ? callName(settings.callMode, settings.customName) : "你"}
    />
  );
}
