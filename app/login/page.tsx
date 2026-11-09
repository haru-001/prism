import { redirect } from "next/navigation";
import { isAuthed, passwordConfigured } from "@/lib/server/auth";
import { setupProblems } from "@/lib/server/env";
import { SetupProblems } from "@/components/SetupProblems";
import { LoginForm } from "@/components/LoginForm";
import { DbSleeping } from "@/components/DbLazy";
import { isDbDown } from "@/lib/server/mysql";

export const dynamic = "force-dynamic";
export const metadata = { title: "登录 · Prism" };

export default async function LoginPage() {
  const problems = setupProblems();
  if (problems.length) return <SetupProblems problems={problems} />;
  let go: string | null = null;
  try {
    // 还没设过访问密码：去首次引导设密码
    if (!(await passwordConfigured())) go = "/onboarding";
    else if (await isAuthed()) go = "/";
  } catch (e) {
    // 数据库连不上：显示「数据库睡着了」，不白屏
    if (isDbDown(e)) return <DbSleeping kind={e.kind} />;
    throw e;
  }
  if (go) redirect(go);
  return <LoginForm />;
}
