"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { isListPage } from "./nav";

/** 上一層路徑：/orders/view/ → /orders/；/orders/ → / */
export function parentPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? `/${parts.slice(0, -1).join("/")}/` : "/";
}

/**
 * 回上一層（不是瀏覽器的上一頁）：
 * - 主功能的列表頁（例如 杯測、庫存中心、整批盤點）→ 主畫面
 * - 新增、明細、編輯等子頁面 → 頁面指定的上一層，未指定時為所屬列表
 * - 網址帶 ?next= 時 → 回到 next（例如從咖啡豆頁進來的表單）
 */
export function upperLevel(path: string, search: string, parent?: string) {
  const q = new URLSearchParams(search);
  const next = q.get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) return next; // 從咖啡豆頁等處進來，回到原處
  const detail = !isListPage(path) || q.has("id");
  if (!detail) return "/";
  return parent ?? parentPath(path);
}

/** 頁面標題左側的回上一層按鈕；主畫面不顯示 */
export function BackButton({ parent }: { parent?: string }) {
  const path = usePathname();
  const router = useRouter();
  if (path === "/") return null;
  const go = () => router.push(upperLevel(path, window.location.search, parent));
  return (
    <button type="button" onClick={go} className="-ml-2 shrink-0 rounded-lg p-1.5 text-fg/70 hover:bg-surface-2 hover:text-fg" aria-label="回上一層" title="回上一層">
      <ArrowLeft size={22} strokeWidth={1.75} />
    </button>
  );
}
