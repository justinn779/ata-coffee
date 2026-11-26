/**
 * 商城設定（settings/store）。沒有設定的欄位一律用預設值，正式運費、免運門檻、銀行帳號不寫死：
 * 預設值都標記 isDemo，商城畫面與後台會顯示「示範設定」，正式上線前必須在後台填寫。
 */
import type { Firestore } from "firebase-admin/firestore";
import type { Tx } from "../tx";
import { C } from "../types";

export interface StoreSettings {
  open: boolean;
  maintenance: boolean;
  maintenanceMessage: string;
  bank: { bankName: string; bankCode: string; branch: string; accountNo: string; accountName: string; isDemo: boolean; /** 轉帳 QR Code 圖片網址（選填） */ qrImage: string };
  paymentDeadlineHours: number;
  paymentReminderHours: number;
  shipping: { fee: string; freeThreshold: string | null; freeBasis: "AFTER_ITEM_DISCOUNT" | "SUBTOTAL"; isDemo: boolean };
  pickupChannels: Array<{ key: "SEVEN" | "FAMILY"; label: string; enabled: boolean }>;
  logisticsProvider: "MANUAL";
  prepDays: number;
  /** 不出貨的星期（0＝週日） */
  nonShipWeekdays: number[];
  /** 不出貨的日期 YYYY-MM-DD */
  nonShipDates: string[];
  grindOptions: Array<{ key: string; label: string; enabled: boolean }>;
  /** 批次品質限制：出貨日距離賞味期限至少要剩幾天 */
  minShelfDaysAtShip: number;
  maxQtyPerLine: number;
  service: { email: string; phone: string; lineUrl: string; hours: string };
  social: { instagram: string; facebook: string; line: string };
  /** 業者資訊（法規必要揭露）：空白時前台顯示「待補」並列入上線阻擋 */
  business: { name: string; taxId: string; address: string; foodRegNo: string; phone: string };
  lineNotifyEnabled: boolean;
}

export const DEFAULT_STORE: StoreSettings = {
  open: true,
  maintenance: false,
  maintenanceMessage: "",
  bank: { bankName: "示範銀行（請於後台設定）", bankCode: "000", branch: "", accountNo: "0000000000000", accountName: "ATA Coffee（示範）", isDemo: true, qrImage: "" },
  paymentDeadlineHours: 72,
  paymentReminderHours: 24,
  shipping: { fee: "60", freeThreshold: "1500", freeBasis: "AFTER_ITEM_DISCOUNT", isDemo: true },
  pickupChannels: [
    { key: "SEVEN", label: "7-ELEVEN", enabled: true },
    { key: "FAMILY", label: "全家", enabled: true },
  ],
  logisticsProvider: "MANUAL",
  prepDays: 2,
  nonShipWeekdays: [0],
  nonShipDates: [],
  grindOptions: [
    { key: "POUR_OVER", label: "手沖", enabled: true },
    { key: "ESPRESSO", label: "義式", enabled: true },
    { key: "FRENCH_PRESS", label: "法壓", enabled: true },
    { key: "MOKA", label: "摩卡壺", enabled: true },
    { key: "DRIP_MACHINE", label: "美式咖啡機", enabled: true },
    { key: "OTHER", label: "其他（備註說明）", enabled: true },
  ],
  minShelfDaysAtShip: 14,
  maxQtyPerLine: 20,
  service: { email: "", phone: "", lineUrl: "", hours: "" },
  social: { instagram: "", facebook: "", line: "" },
  business: { name: "", taxId: "", address: "", foodRegNo: "", phone: "" },
  lineNotifyEnabled: false,
};

function merge(d: Record<string, unknown> | undefined | null): StoreSettings {
  const s = (d ?? {}) as Partial<StoreSettings>;
  return {
    ...DEFAULT_STORE,
    ...s,
    bank: { ...DEFAULT_STORE.bank, ...(s.bank ?? {}) },
    shipping: { ...DEFAULT_STORE.shipping, ...(s.shipping ?? {}) },
    service: { ...DEFAULT_STORE.service, ...(s.service ?? {}) },
    social: { ...DEFAULT_STORE.social, ...(s.social ?? {}) },
    business: { ...DEFAULT_STORE.business, ...(s.business ?? {}) },
    pickupChannels: s.pickupChannels?.length ? s.pickupChannels : DEFAULT_STORE.pickupChannels,
    grindOptions: s.grindOptions?.length ? s.grindOptions : DEFAULT_STORE.grindOptions,
  };
}

export async function storeSettings(tx: Tx): Promise<StoreSettings> {
  const d = await tx.get(C.settings, "store");
  return merge(d);
}

export async function storeSettingsDb(db: Firestore): Promise<StoreSettings> {
  return merge((await db.collection(C.settings).doc("store").get()).data());
}

// ───────────── 出貨日 ─────────────

const ymd = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10);

export function isShipDay(s: StoreSettings, date: string) {
  const wd = new Date(`${date}T12:00:00+08:00`).getUTCDay();
  return !s.nonShipWeekdays.includes(wd) && !s.nonShipDates.includes(date);
}

/** 從今天（臺北）起加上備貨天數，跳過不出貨日；回傳最早可出貨日 */
export function earliestShipDate(s: StoreSettings, now = new Date(), extraDays = 0) {
  let d = new Date(`${ymd(now)}T12:00:00+08:00`);
  let need = Math.max(0, s.prepDays + extraDays);
  for (let guard = 0; guard < 400; guard++) {
    const day = ymd(d);
    if (isShipDay(s, day)) {
      if (need === 0) return day;
      need--;
    }
    d = new Date(d.getTime() + 86400_000);
  }
  return ymd(d);
}

export const addDays = (date: string, n: number) => new Date(new Date(`${date}T12:00:00+08:00`).getTime() + n * 86400_000 + 8 * 3600_000).toISOString().slice(0, 10);
