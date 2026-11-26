"use client";

import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate, AuthProvider, logout, useAuth } from "@/components/auth";
import { Loading } from "@/lib/page";

function Shell({ children }: { children: React.ReactNode }) {
  const { admin, user } = useAuth();
  return (
    <AppShell user={{ name: admin?.name ?? "管理員", email: user?.email ?? "" }} logout={async () => { await logout(); }}>
      <Suspense fallback={<Loading />}>{children}</Suspense>
    </AppShell>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthGate>
        <Shell>{children}</Shell>
      </AuthGate>
    </AuthProvider>
  );
}
