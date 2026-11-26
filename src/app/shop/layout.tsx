import type { Metadata } from "next";
import { ShopShell } from "./_shell";
import "./shop.css";

export const metadata: Metadata = {
  title: { absolute: "ATA Coffee", template: "%s｜ATA Coffee" },
  description: "用一杯咖啡，開啟每段獨特體驗。ATA Coffee 精品咖啡豆、濾掛與禮盒。",
  robots: { index: true, follow: true },
  openGraph: { title: "ATA Coffee", description: "用一杯咖啡，開啟每段獨特體驗。", type: "website", locale: "zh_TW", siteName: "ATA Coffee" },
};

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return <ShopShell>{children}</ShopShell>;
}
