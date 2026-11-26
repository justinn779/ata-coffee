import type { Metadata } from "next";

// 私人頁面：不讓搜尋引擎索引
export const metadata: Metadata = { title: "登入", robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
