"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { cn } from "./ui";

export interface Column {
  key: string;
  label: string;
  align?: "left" | "right";
  sortable?: boolean;
  /** 手機卡片模式下隱藏 */
  hideOnMobile?: boolean;
}
export interface Row {
  id: string;
  href?: string;
  cells: Record<string, ReactNode>;
  sort?: Record<string, string | number | null>;
  search: string;
  filters?: Record<string, string>;
}
export interface FilterDef {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}

/**
 * 通用資料表：搜尋、篩選、排序、分頁；手機版自動改為卡片列表。
 * 資料由伺服器元件準備（儲存格為已渲染的 ReactNode）。
 */
export function DataTable({ columns, rows, filters = [], pageSize = 20, searchPlaceholder = "搜尋…", empty = "沒有符合條件的資料" }: { columns: Column[]; rows: Row[]; filters?: FilterDef[]; pageSize?: number; searchPlaceholder?: string; empty?: string }) {
  const [q, setQ] = useState("");
  const [f, setF] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => (!needle || r.search.toLowerCase().includes(needle)) && Object.entries(f).every(([k, v]) => !v || r.filters?.[k] === v));
    if (sort) {
      out = [...out].sort((a, b) => {
        const x = a.sort?.[sort.key] ?? null;
        const y = b.sort?.[sort.key] ?? null;
        if (x === y) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return (x < y ? -1 : 1) * sort.dir;
      });
    }
    return out;
  }, [rows, q, f, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const visible = filtered.slice(cur * pageSize, cur * pageSize + pageSize);

  const toggleSort = (key: string) => setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface">
      <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor="dt-search">
          搜尋
        </label>
        <input
          id="dt-search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          placeholder={searchPlaceholder}
          className="h-9 w-full rounded-lg border border-border bg-bg px-3 text-sm sm:max-w-xs"
        />
        {filters.map((fd) => (
          <select
            key={fd.key}
            aria-label={fd.label}
            value={f[fd.key] ?? ""}
            onChange={(e) => {
              setF({ ...f, [fd.key]: e.target.value });
              setPage(0);
            }}
            className="h-9 rounded-lg border border-border bg-bg px-2 text-sm"
          >
            <option value="">全部{fd.label}</option>
            {fd.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
        <span className="text-xs text-muted sm:ml-auto">共 {filtered.length} 筆</span>
      </div>

      {visible.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">{empty}</p>
      ) : (
        <>
          {/* 桌面：表格 */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  {columns.map((c) => (
                    <th key={c.key} className={cn("px-4 py-2.5 font-medium whitespace-nowrap", c.align === "right" && "text-right")} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                      {c.sortable ? (
                        <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-fg">
                          {c.label}
                          <span aria-hidden className="text-[10px]">
                            {sort?.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : "↕"}
                          </span>
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-bg">
                    {columns.map((c, i) => (
                      <td key={c.key} className={cn("num px-4 py-2.5 align-middle", c.align === "right" && "text-right")}>
                        {i === 0 && r.href ? (
                          <Link href={r.href} className="font-medium text-primary hover:underline">
                            {r.cells[c.key]}
                          </Link>
                        ) : (
                          r.cells[c.key]
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* 手機：卡片 */}
          <ul className="divide-y divide-border md:hidden">
            {visible.map((r) => {
              const [first, ...rest] = columns.filter((c) => !c.hideOnMobile);
              const body = (
                <div className="px-4 py-3">
                  <div className="font-medium text-fg">{r.cells[first.key]}</div>
                  <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {rest.map((c) => (
                      <div key={c.key} className="min-w-0">
                        <dt className="text-muted">{c.label}</dt>
                        <dd className="num truncate text-fg">{r.cells[c.key]}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
              return (
                <li key={r.id}>
                  {r.href ? (
                    <Link href={r.href} className="block active:bg-surface-2">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-sm">
          <button type="button" disabled={cur === 0} onClick={() => setPage(cur - 1)} className="rounded px-2 py-1 text-primary disabled:text-muted">
            ← 上一頁
          </button>
          <span className="text-xs text-muted">
            第 {cur + 1} / {pages} 頁
          </span>
          <button type="button" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} className="rounded px-2 py-1 text-primary disabled:text-muted">
            下一頁 →
          </button>
        </div>
      )}
    </div>
  );
}
