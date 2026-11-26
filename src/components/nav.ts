import { Bean, ShoppingBag, Tag, BarChart3, Settings, Store } from "lucide-react";

export type NavTab = { href: string; label: string };
export type NavModule = { key: string; label: string; desc: string; icon: typeof Bean; tabs: NavTab[] };

/**
 * 主功能與其子功能（分頁）。主畫面的功能磚、功能選單、各頁上方的子功能分頁共用這份清單。
 * 第一個分頁即主功能的入口。
 */
export const MODULES: NavModule[] = [
  {
    key: "coffee",
    label: "咖啡豆",
    desc: "以咖啡豆為主角：生豆採購、烘豆、杯測、手沖、分裝、庫存都在同一處",
    icon: Bean,
    tabs: [
      { href: "/coffees/", label: "咖啡豆" },
      { href: "/green/", label: "生豆採購" },
      { href: "/roasting/", label: "烘豆" },
      { href: "/cupping/", label: "杯測" },
      { href: "/brewing/", label: "手沖" },
      { href: "/production/", label: "分裝" },
      { href: "/inventory/", label: "庫存" },
      { href: "/flavors/", label: "風味描述" },
      { href: "/inventory/count/", label: "整批盤點" },
      { href: "/inventory/ledger/", label: "庫存帳本" },
    ],
  },
  {
    key: "sales",
    label: "訂單與顧客",
    desc: "接單、付款、出貨、顧客",
    icon: ShoppingBag,
    tabs: [
      { href: "/orders/", label: "訂單管理" },
      { href: "/customers/", label: "顧客" },
    ],
  },
  {
    key: "product",
    label: "商品與品牌",
    desc: "商品與規格、品牌系列、QR 履歷",
    icon: Tag,
    tabs: [
      { href: "/products/", label: "商品" },
      { href: "/series/", label: "品牌系列與履歷" },
    ],
  },
  {
    key: "store",
    label: "官方商城",
    desc: "付款對帳、商城商品、預購、優惠、首頁內容",
    icon: Store,
    tabs: [
      { href: "/store/", label: "商城總覽" },
      { href: "/store/payments/", label: "付款對帳" },
      { href: "/store/products/", label: "商城商品" },
      { href: "/store/preorders/", label: "預購" },
      { href: "/store/promotions/", label: "優惠" },
      { href: "/store/content/", label: "首頁與內容" },
      { href: "/store/settings/", label: "商城設定" },
      { href: "/store/reports/", label: "電商報表" },
    ],
  },
  { key: "report", label: "成本與報表", desc: "營收、成本、毛利", icon: BarChart3, tabs: [{ href: "/reports/", label: "成本與報表" }] },
  { key: "settings", label: "系統設定", desc: "帳號、通知、基本資料", icon: Settings, tabs: [{ href: "/settings/", label: "系統設定" }] },
];

const norm = (path: string) => (path.endsWith("/") ? path : `${path}/`);

/** 目前路徑對應的子功能（最長前綴，例如 /inventory/count/ 對應「整批盤點」而非「庫存中心」） */
export function findTab(path: string): { module: NavModule; tab: NavTab } | undefined {
  const p = norm(path);
  let best: { module: NavModule; tab: NavTab } | undefined;
  for (const m of MODULES) for (const tab of m.tabs) if (p.startsWith(tab.href) && (!best || tab.href.length > best.tab.href.length)) best = { module: m, tab };
  return best;
}

/** 新增、明細、編輯、比較等子頁面不顯示子功能分頁（用左上角 ← 返回） */
export const isListPage = (path: string) => !/\/(new|view|edit|variant|lot|compare|live)\/?$/.test(norm(path));
