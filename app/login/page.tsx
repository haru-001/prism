import { redirect } from "next/navigation";
import { isAuthed, passwordConfigured } from "@/lib/server/auth";
import { setupProblems } from "@/lib/server/env";
import { SetupProblems } from "@/components/SetupProblems";
import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "登录 · Prism" };

export default async function LoginPage() {
  const problems = setupProblems();
  if (problems.length) return <SetupProblems problems={problems} />;
  // 还没设过访问密码：去首次引导设密码
  if (!(await passwordConfigured())) redirect("/onboarding");
  if (await isAuthed()) redirect("/");
  return <LoginForm />;
}
