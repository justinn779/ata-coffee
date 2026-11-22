import Link from "next/link";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ComponentProps, ReactNode } from "react";
import { BackButton } from "./back-button";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
const btn: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg hover:opacity-90",
  secondary: "bg-primary-soft text-fg hover:bg-surface-2",
  outline: "border border-border-strong bg-surface text-fg hover:bg-surface-2",
  ghost: "text-fg hover:bg-surface-2",
  danger: "bg-danger text-primary-fg hover:opacity-90",
};
export const buttonClass = (variant: Variant = "primary", size: "sm" | "md" = "md") =>
  cn(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none",
    size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm",
    btn[variant],
  );

export function Button({ variant = "primary", size = "md", className, ...p }: ComponentProps<"button"> & { variant?: Variant; size?: "sm" | "md" }) {
  return <button className={cn(buttonClass(variant, size), className)} {...p} />;
}

export function LinkButton({ variant = "primary", size = "md", className, ...p }: ComponentProps<typeof Link> & { variant?: Variant; size?: "sm" | "md" }) {
  return <Link className={cn(buttonClass(variant, size), className)} {...p} />;
}

export function Card({ className, ...p }: ComponentProps<"section">) {
  return <section className={cn("rounded-[var(--radius-card)] border border-border bg-surface", className)} {...p} />;
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 border-b border-border px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...p }: ComponentProps<"div">) {
  return <div className={cn("p-5", className)} {...p} />;
}

export type Tone = "neutral" | "primary" | "sage" | "warning" | "danger" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  primary: "bg-primary-soft text-primary",
  sage: "bg-sage-soft text-sage",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <BackButton fallback={back?.href} />
          <h1 className="font-serif text-2xl font-semibold tracking-wide text-fg">{title}</h1>
        </div>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function StatCard({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: Tone }) {
  const inner = (
    <div className={cn("h-full rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors", href && "hover:border-border-strong")}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        {tone && <span className={cn("h-2 w-2 rounded-full", { neutral: "bg-muted", primary: "bg-primary", sage: "bg-sage", warning: "bg-warning", danger: "bg-danger", info: "bg-info" }[tone])} aria-hidden />}
      </div>
      <p className="num mt-2 text-xl font-semibold text-fg">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border-strong px-6 py-12 text-center">
      <div className="mb-3 h-10 w-10 rounded-full bg-primary-soft" aria-hidden />
      <p className="font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function KV({ items, cols = 3 }: { items: Array<[string, ReactNode]>; cols?: 2 | 3 | 4 }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2", cols === 3 && "lg:grid-cols-3", cols === 4 && "lg:grid-cols-4")}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="num mt-0.5 break-words text-sm text-fg">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs({ tabs, active }: { tabs: Array<{ key: string; label: string; href: string; count?: number }>; active: string }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-border" aria-label="分頁">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap",
            t.key === active ? "border-primary font-medium text-primary" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 text-xs text-muted">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={cn("rounded-lg px-4 py-3 text-sm", tones[tone])}>{children}</div>;
}

export function SimpleTable({ head, rows, empty = "尚無資料" }: { head: ReactNode[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="px-5 py-6 text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} className="px-4 py-2.5 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {r.map((c, j) => (
                <td key={j} className="num px-4 py-2.5 align-top whitespace-nowrap">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="font-medium text-primary hover:underline">
    {children}
  </Link>
);
