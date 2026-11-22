"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { House, LayoutGrid, X, Moon, Sun, LogOut } from "lucide-react";
import { cn } from "./ui";
import { BrandMark } from "./brand";
import { MODULES, findTab, isListPage } from "./nav";
import { useTrackNav } from "./back-button";

export function AppShell({ user, logout, children }: { user: { name: string; email: string }; logout: () => Promise<void>; children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useTrackNav();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const home = path === "/";
  const cur = findTab(path);
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
              <nav aria-label="功能" className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                {MODULES.map((m) => {
                  const Icon = m.icon;
                  const inModule = cur?.module.key === m.key;
                  return (
                    <div key={m.key}>
                      <Link href={m.tabs[0].href} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium", inModule ? "bg-primary-soft text-primary" : "text-fg hover:bg-surface-2")}>
                        <Icon size={18} strokeWidth={1.75} aria-hidden />
                        {m.label}
                      </Link>
                      {m.tabs.length > 1 && (
                        <ul className="mt-0.5 ml-[2.4rem] space-y-0.5 border-l border-border pl-2">
                          {m.tabs.map((t) => {
                            const on = cur?.tab.href === t.href;
                            return (
                              <li key={t.href}>
                                <Link href={t.href} aria-current={on ? "page" : undefined} className={cn("block rounded-md px-2 py-1.5 text-sm", on ? "font-medium text-primary" : "text-fg/75 hover:bg-surface-2 hover:text-fg")}>
                                  {t.label}
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>
      )}

      <main className="px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-7xl">
          {cur && cur.module.tabs.length > 1 && isListPage(path) && <ModuleTabs module={cur.module} active={cur.tab.href} />}
          {children}
        </div>
      </main>
    </div>
  );
}
/** 主功能底下的子功能切換（只在列表頁顯示） */
function ModuleTabs({ module: m, active }: { module: (typeof MODULES)[number]; active: string }) {
  const Icon = m.icon;
  return (
    <nav aria-label={`${m.label}子功能`} className="mb-5 flex items-center gap-2 overflow-x-auto pb-1">
      <span className="mr-1 flex shrink-0 items-center gap-1.5 text-sm text-muted">
        <Icon size={16} strokeWidth={1.75} aria-hidden />
        {m.label}
      </span>
      {m.tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === active ? "page" : undefined}
          className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors", t.href === active ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface text-fg/80 hover:border-primary/50 hover:text-fg")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
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
