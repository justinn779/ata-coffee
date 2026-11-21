import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/server/auth";
import { logoutAction } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <AppShell user={{ name: user.name, email: user.email }} logout={logoutAction}>
      {children}
    </AppShell>
  );
}
