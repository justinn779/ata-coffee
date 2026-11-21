import type { Tone } from "@/components/ui";

export const PAYMENT: Record<string, [string, Tone]> = {
  UNPAID: ["未付款", "danger"],
  PENDING_CONFIRMATION: ["待確認", "warning"],
  PAID: ["已付款", "sage"],
  REFUNDED: ["已退款", "neutral"],
  PARTIALLY_REFUNDED: ["部分退款", "warning"],
};
export const FULFILL: Record<string, [string, Tone]> = {
  PENDING: ["待處理", "neutral"],
  AWAITING_PACKAGING: ["待分裝", "warning"],
  READY_TO_SHIP: ["可出貨", "info"],
  SHIPPED: ["已出貨", "primary"],
  COMPLETED: ["已完成", "sage"],
  CANCELLED: ["已取消", "neutral"],
  RETURN_PROCESSING: ["退貨處理中", "danger"],
};
export const PROD_STATUS: Record<string, [string, Tone]> = {
  PLANNED: ["規劃中", "warning"],
  COMPLETED: ["已完成", "sage"],
  CANCELLED: ["已取消", "neutral"],
};
export const PROD_MODE: Record<string, string> = { PRE_PACK: "預先分裝", MADE_TO_ORDER: "接單後分裝" };
export const LOT_STATUS: Record<string, [string, Tone]> = {
  AVAILABLE: ["可用", "sage"],
  QUARANTINE: ["待檢", "danger"],
  HOLD: ["品質保留", "warning"],
  SCRAPPED: ["已報廢", "neutral"],
};
export const PRODUCT_CATEGORY: Record<string, string> = {
  COFFEE_BEAN: "咖啡豆",
  DRIP_BAG: "濾掛",
  DRIP_BAG_SET: "濾掛組合",
  GIFT_BOX: "禮盒",
  MERCH: "咖啡周邊",
  OTHER: "其他",
};
export const PRODUCT_STATUS: Record<string, [string, Tone]> = {
  DRAFT: ["草稿", "neutral"],
  ACTIVE: ["上架中", "sage"],
  INACTIVE: ["下架", "warning"],
  ARCHIVED: ["封存", "neutral"],
};
export const STOCK_POLICY: Record<string, string> = { STOCK_ONLY: "僅售現貨", MADE_TO_ORDER: "可接單後分裝", NOT_TRACKED: "不追蹤庫存" };
export const MATERIAL_CATEGORY: Record<string, string> = { BAG: "包裝袋", LABEL: "標籤", DRIP_BAG: "濾掛袋", BOX: "盒", SEAL: "封口", OTHER: "其他" };
export const EQUIPMENT_TYPE: Record<string, string> = { GRINDER: "磨豆機", DRIPPER: "濾杯", FILTER: "濾紙", KETTLE: "手沖壺", SCALE: "電子秤", OTHER: "其他" };
export const COST_CATEGORY: Record<string, string> = {
  ROAST_ENERGY: "烘焙能源",
  ROAST_LABOR: "烘焙人工",
  PACKAGING_LABOR: "包裝人工",
  CONSUMABLES: "其他耗材",
  SHIPPING: "配送成本",
  PLATFORM_FEE: "平台手續費",
  PAYMENT_FEE: "金流手續費",
  ORDER_OTHER: "其他訂單直接成本",
  OPERATING_EXPENSE: "營運費用",
};
export const RESEARCH_STATUS: Record<string, [string, Tone]> = {
  PLANNING: ["規劃中", "neutral"],
  RUNNING: ["進行中", "info"],
  CONCLUDED: ["已結論", "sage"],
  ARCHIVED: ["封存", "neutral"],
};
export const ROAST_EVENT: Record<string, string> = {
  CHARGE: "入豆",
  TURNING_POINT: "轉折點",
  DRY_END: "轉黃點",
  FC_START: "一爆開始",
  FC_END: "一爆結束",
  SC_START: "二爆開始",
  DROP: "下豆",
  HEAT_CHANGE: "火力調整",
  AIRFLOW_CHANGE: "風門調整",
  DRUM_CHANGE: "轉速調整",
  NOTE: "備註",
};
export const SERIES_CHARACTER: Record<string, string> = { NONE: "無", ATI: "Ati", ATO: "Ato", BOTH: "Ati & Ato" };
export const PAYMENT_METHOD: Record<string, string> = { BANK_TRANSFER: "銀行匯款", CASH: "現金", CARD: "信用卡", OTHER: "其他" };

export const opts = (m: Record<string, string | [string, Tone]>) => Object.entries(m).map(([value, l]) => ({ value, label: Array.isArray(l) ? l[0] : l }));
