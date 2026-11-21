import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { BrandMark } from "@/components/brand";
import { LoginForm } from "./login-form";

export const metadata = { title: "登入" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6">
          <h1 className="font-serif text-xl font-semibold">管理員登入</h1>
          <p className="mt-1 text-sm text-muted">請使用管理員帳號登入後台</p>
          <LoginForm next={next?.startsWith("/") && !next.startsWith("//") ? next : "/"} />
        </div>
        <p className="mt-6 text-center text-xs text-muted">ATA Coffee Management System</p>
      </div>
    </main>
  );
}
