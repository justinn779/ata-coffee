"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { House, LayoutGrid, X, Moon, Sun, LogOut } from "lucide-react";
import { cn } from "./ui";
import { BrandMark } from "./brand";
import { NAV } from "./nav";

/** 目前頁面對應的功能（取最長的路徑前綴，例如 /inventory/count/ 對應「整批盤點」而非「庫存中心」） */
export function activeHref(path: string) {
  const p = path.endsWith("/") ? path : `${path}/`;
  return NAV.flatMap((g) => g.items.map((i) => i.href))
    .filter((h) => p.startsWith(h))
    .sort((a, b) => b.length - a.length)[0];
}

export function AppShell({ user, logout, children }: { user: { name: string; email: string }; logout: () => Promise<void>; children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const home = path === "/";
  const active = activeHref(path);
  const iconBtn = "rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg";

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur print:hidden">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 md:px-8">
          <BrandMark />
          <div className="ml-auto flex items-center gap-1">
            {!home && (
              <Link href="/" className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-fg/80 hover:bg-surface-2 hover:text-fg">
                <House size={18} strokeWidth={1.75} aria-hidden />
                <span className="hidden sm:inline">主畫面</span>
                <span className="sr-only sm:hidden">主畫面</span>
              </Link>
            )}
            <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-fg/80 hover:bg-surface-2 hover:text-fg" aria-label="開啟選單" aria-expanded={open}>
              <LayoutGrid size={18} strokeWidth={1.75} aria-hidden />
              <span className="hidden sm:inline">功能選單</span>
            </button>
            <ThemeToggle />
            <Link href="/settings/?s=account" className="hidden max-w-40 truncate rounded-lg px-2 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg lg:block" title={user.email}>
              {user.name}
            </Link>
            <form action={logout}>
              <button type="submit" className={iconBtn} aria-label="登出" title="登出">
                <LogOut size={18} />
              </button>
            </form>
          </div>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="主選單">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 top-0 max-h-dvh overflow-y-auto border-b border-border bg-surface shadow-xl">
            <div className="mx-auto max-w-7xl px-4 pt-4 pb-6 md:px-8">
              <div className="mb-3 flex items-center justify-between">
                <Link href="/" className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", home ? "bg-primary-soft font-medium text-primary" : "text-fg/80 hover:bg-surface-2 hover:text-fg")}>
                  <House size={18} strokeWidth={1.75} aria-hidden />
                  回主畫面
                </Link>
                <button type="button" onClick={() => setOpen(false)} className={iconBtn} aria-label="關閉選單">
                  <X size={20} />
                </button>
              </div>
              <nav aria-label="功能" className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                {NAV.map((g) => (
                  <div key={g.group}>
                    <p className="mb-1 px-3 text-[11px] font-medium tracking-wider text-muted">{g.group}</p>
                    <ul className="space-y-0.5">
                      {g.items.map((it) => {
                        const Icon = it.icon;
                        const on = it.href === active;
                        return (
                          <li key={it.href}>
                            <Link href={it.href} aria-current={on ? "page" : undefined} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm", on ? "bg-primary-soft font-medium text-primary" : "text-fg/80 hover:bg-surface-2 hover:text-fg")}>
                              <Icon size={18} strokeWidth={1.75} aria-hidden />
                              {it.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </nav>
            </div>
          </div>
        </div>
      )}

      <main className="px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    const t = document.documentElement.dataset.theme as "light" | "dark" | undefined;
    setTheme(t ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {}
    setTheme(next);
  };
  return (
    <button type="button" onClick={toggle} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label={theme === "dark" ? "切換為亮色模式" : "切換為暗色模式"} title="切換亮／暗色">
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
