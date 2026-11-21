"use client";

/** 用戶端 CSV 匯出（UTF-8 BOM，Excel 可直接開啟；防止公式注入） */
const esc = (v: unknown) => {
  if (v == null) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function toCsv(rows: Array<Record<string, unknown>>) {
  const head = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return "﻿" + [head.join(","), ...rows.map((r) => head.map((k) => esc(r[k])).join(","))].join("\r\n");
}

export function downloadCsv(name: string, rows: Array<Record<string, unknown>>) {
  downloadBlob(`ata-${name}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.csv`, new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
