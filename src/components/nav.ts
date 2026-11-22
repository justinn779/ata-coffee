import { Bean, Truck, Flame, Palette, FlaskConical, Coffee, Boxes, ClipboardCheck, PackageOpen, Tag, ShoppingBag, Users, BarChart3, Sparkles, Settings } from "lucide-react";

export type NavItem = { href: string; label: string; desc: string; icon: typeof Bean };
export type NavGroup = { group: string; items: NavItem[] };

/** 功能分區：主畫面的功能磚與頂列「功能選單」共用 */
export const NAV: NavGroup[] = [
  {
    group: "咖啡豆",
    items: [
      { href: "/coffees/", label: "生豆資訊", desc: "產地、品種、處理法", icon: Bean },
      { href: "/green/", label: "生豆來源", desc: "採購批次與供應商", icon: Truck },
      { href: "/roasting/", label: "烘豆紀錄", desc: "烘焙批次與曲線", icon: Flame },
      { href: "/flavors/", label: "風味描述", desc: "各支豆子的風味與詞彙", icon: Palette },
      { href: "/cupping/", label: "杯測", desc: "杯測評分與比較", icon: FlaskConical },
      { href: "/brewing/", label: "手沖", desc: "手沖紀錄與配方", icon: Coffee },
    ],
  },
  {
    group: "庫存與生產",
    items: [
      { href: "/inventory/", label: "庫存中心", desc: "生豆、熟豆、成品、包材", icon: Boxes },
      { href: "/inventory/count/", label: "整批盤點", desc: "實盤數量與差異調整", icon: ClipboardCheck },
      { href: "/production/", label: "分裝生產", desc: "分裝單與包裝批次", icon: PackageOpen },
    ],
  },
  {
    group: "銷售與經營",
    items: [
      { href: "/orders/", label: "訂單管理", desc: "接單、付款、出貨", icon: ShoppingBag },
      { href: "/products/", label: "商品與品項", desc: "售價、規格、套組", icon: Tag },
      { href: "/customers/", label: "顧客", desc: "顧客資料與訂單紀錄", icon: Users },
      { href: "/reports/", label: "成本與報表", desc: "營收、成本、毛利", icon: BarChart3 },
      { href: "/series/", label: "品牌系列與履歷", desc: "系列與 QR 履歷頁", icon: Sparkles },
    ],
  },
  { group: "系統", items: [{ href: "/settings/", label: "系統設定", desc: "帳號、通知、基本資料", icon: Settings }] },
];
