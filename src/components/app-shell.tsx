"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Bean,
  Flame,
  FlaskConical,
  Coffee,
  Microscope,
  Boxes,
  PackageOpen,
  Tag,
  ShoppingBag,
  Users,
  BarChart3,
  Sparkles,
  Settings,
  Menu,
  X,
  Moon,
  Sun,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "./ui";
import { BrandMark } from "./brand";

const NAV: Array<{ group: string; items: Array<{ href: string; label: string; icon: typeof Bean }> }> = [
  { group: "總覽", items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    group: "烘焙與研發",
    items: [
      { href: "/coffees", label: "咖啡豆資料", icon: Bean },
      { href: "/roasting", label: "烘焙中心", icon: Flame },
      { href: "/cupping", label: "杯測實驗室", icon: FlaskConical },
      { href: "/brewing", label: "手沖實驗室", icon: Coffee },
      { href: "/research", label: "研究專案", icon: Microscope },
    ],
  },
  {
    group: "庫存與生產",
    items: [
      { href: "/inventory", label: "庫存中心", icon: Boxes },
      { href: "/production", label: "分裝生產", icon: PackageOpen },
    ],
  },
  {
    group: "銷售與經營",
    items: [
      { href: "/products", label: "商品與 SKU", icon: Tag },
      { href: "/orders", label: "訂單管理", icon: ShoppingBag },
      { href: "/customers", label: "顧客", icon: Users },
      { href: "/reports", label: "成本與報表", icon: BarChart3 },
      { href: "/series", label: "品牌系列與履歷", icon: Sparkles },
    ],
  },
  { group: "系統", items: [{ href: "/settings/", label: "系統設定", icon: Settings }] },
];

export function AppShell({ user, logout, children }: { user: { name: string; email: string }; logout: () => Promise<void>; children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sidebar") === "collapsed");
    } catch {}
  }, []);
  const toggleCollapse = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("sidebar", c ? "open" : "collapsed");
      } catch {}
      return !c;
    });
  };
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  const nav = (compact: boolean) => (
    <nav aria-label="主選單" className="flex-1 overflow-y-auto px-3 py-4">
      {NAV.map((g) => (
        <div key={g.group} className="mb-4">
          {!compact && <p className="mb-1 px-3 text-[11px] font-medium tracking-wider text-muted uppercase">{g.group}</p>}
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const Icon = it.icon;
              const active = isActive(it.href);
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    title={compact ? it.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active ? "bg-primary-soft font-medium text-primary" : "text-fg/80 hover:bg-surface-2 hover:text-fg",
                      compact && "justify-center px-0",
                    )}
                  >
                    <Icon size={18} strokeWidth={1.75} aria-hidden />
                    {!compact && it.label}
                    {compact && <span className="sr-only">{it.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const footer = (compact: boolean) => (
    <div className={cn("flex items-center gap-2 border-t border-border p-3", compact && "flex-col")}>
      {!compact && (
        <Link href="/settings/?s=account" className="min-w-0 flex-1 rounded-lg px-2 py-1 hover:bg-surface-2">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
        </Link>
      )}
      <ThemeToggle />
      <form action={logout}>
        <button type="submit" className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label="登出" title="登出">
          <LogOut size={18} />
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-dvh">
      {/* 桌面／平板側欄 */}
      <aside className={cn("fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-surface md:flex", collapsed ? "w-[68px]" : "w-64")}>
        <div className={cn("flex h-16 items-center gap-2 border-b border-border px-4", collapsed && "justify-center px-0")}>
          <BrandMark compact={collapsed} />
        </div>
        {nav(collapsed)}
        <button type="button" onClick={toggleCollapse} className="mx-3 mb-2 hidden items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-muted hover:bg-surface-2 md:flex" aria-label={collapsed ? "展開側欄" : "收合側欄"}>
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && "收合側欄"}
        </button>
        {footer(collapsed)}
      </aside>

      {/* 手機頂列 */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur md:hidden">
        <button type="button" onClick={() => setOpen(true)} className="-ml-2 rounded-lg p-2" aria-label="開啟選單" aria-expanded={open}>
          <Menu size={22} />
        </button>
        <BrandMark />
      </header>

      {/* 手機抽屜 */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="主選單">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <BrandMark />
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2" aria-label="關閉選單">
                <X size={20} />
              </button>
            </div>
            {nav(false)}
            {footer(false)}
          </aside>
        </div>
      )}

      <main className={cn("px-4 py-6 md:px-8 md:py-8", collapsed ? "md:pl-[calc(68px+2rem)]" : "md:pl-[calc(16rem+2rem)]")}>
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
