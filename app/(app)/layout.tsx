import { redirect } from "next/navigation";
import { isAuthed, passwordConfigured } from "@/lib/server/auth";
import { setupProblems } from "@/lib/server/env";
import { getOnboarding } from "@/lib/server/store";
import { AppProvider } from "@/components/AppContext";
import { Sidebar } from "@/components/Sidebar";
import { Toaster } from "@/components/ui";
import { SetupProblems } from "@/components/SetupProblems";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const problems = setupProblems();
  if (problems.length) return <SetupProblems problems={problems} />;
  if (!(await isAuthed())) redirect((await passwordConfigured()) ? "/login" : "/onboarding");
  const ob = await getOnboarding();
  if (!ob.completed) redirect("/onboarding");
  return (
    <AppProvider>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
      <Toaster />
    </AppProvider>
  );
}
