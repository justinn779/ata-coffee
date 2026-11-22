"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";

/** 上一層路徑：/orders/view/ → /orders/；/orders/ → / */
export function parentPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? `/${parts.slice(0, -1).join("/")}/` : "/";
}

// 本次開啟網站後在站內換頁的次數；直接開啟某頁（或重新整理）時為 0，回上頁就改去上一層
let inAppNavs = -1;

/** 由版面呼叫，記錄站內換頁 */
export function useTrackNav() {
  const path = usePathname();
  useEffect(() => {
    inAppNavs++;
  }, [path]);
}

/** 頁面標題左側的回上頁按鈕；主畫面不顯示 */
export function BackButton({ fallback }: { fallback?: string }) {
  const path = usePathname();
  const router = useRouter();
  if (path === "/") return null;
  const go = () => (inAppNavs > 0 ? router.back() : router.push(fallback ?? parentPath(path)));
  return (
    <button type="button" onClick={go} className="-ml-2 shrink-0 rounded-lg p-1.5 text-fg/70 hover:bg-surface-2 hover:text-fg" aria-label="回上頁" title="回上頁">
      <ArrowLeft size={22} strokeWidth={1.75} />
    </button>
  );
}
