"use client";

import { httpsCallable } from "firebase/functions";
import { shopFb } from "./firebase-lite";

/** 商城 API（Callable `shop`）。錯誤統一為 ShopCallError（code＋繁中訊息＋附帶資料） */
export class ShopCallError extends Error {
  constructor(
    message: string,
    public code: string,
    public data: Record<string, unknown> | null = null,
    public fieldErrors: Record<string, string> | null = null,
  ) {
    super(message);
  }
}

export async function shopCall<T = Record<string, unknown>>(op: string, input: unknown = {}): Promise<T> {
  try {
    const fn = httpsCallable<{ op: string; input: unknown }, { ok: boolean; data: T }>(shopFb().fns, "shop", { timeout: 60_000 });
    return (await fn({ op, input })).data.data;
  } catch (e) {
    const err = e as { message?: string; code?: string; details?: { code?: string; data?: Record<string, unknown> | null; fieldErrors?: Record<string, string> | null } };
    const offline = err.code === "functions/unavailable" || err.code === "functions/deadline-exceeded";
    throw new ShopCallError(offline ? "網路連線不穩，請稍後再試" : err.code === "functions/internal" ? "系統忙碌中，請稍後再試" : (err.message ?? "發生錯誤"), err.details?.code ?? err.code ?? "ERROR", err.details?.data ?? null, err.details?.fieldErrors ?? null);
  }
}

// ───────────── 型別（與 functions/src/shop 的公開輸出對應） ─────────────

export type SaleState = "IN_STOCK" | "PREORDER" | "PREORDER_FULL" | "SOLD_OUT" | "COMING_SOON";
export interface PublicVariant {
  id: string;
  name: string;
  price: string | null;
  listPrice: string | null;
  weightG: number | null;
  state: SaleState;
  lowStock: number | null;
  maxQty: number;
  shipDate: string | null;
  preorder: { campaignId: string; shipDate: string; endAt: string | null } | null;
  bundle: Array<{ name: string; quantity: number }> | null;
  customBundle: null | { min: number; max: number; allowRepeat?: boolean; pricing?: "FIXED" | "SUM_PLUS"; extra?: string; options?: Array<{ variantId: string; name: string; price: string; image: string | null; available: number; soldOut: boolean }> };
}
export interface PublicProduct {
  id: string;
  slug: string;
  name: string;
  category: "beans" | "drip" | "gift" | "other";
  flavor: string | null;
  summary: string | null;
  images: Array<{ url: string; alt: string }>;
  details: Array<{ title: string; body: string }>;
  grindable: boolean;
  minPrice: string | null;
  state: SaleState;
  variants: PublicVariant[];
}
export interface StorePublicSettings {
  open: boolean;
  maintenance: boolean;
  maintenanceMessage: string;
  pickupChannels: Array<{ key: "SEVEN" | "FAMILY"; label: string }>;
  grindOptions: Array<{ key: string; label: string }>;
  shippingFee: string;
  freeThreshold: string | null;
  paymentDeadlineHours: number;
  service: { email: string; phone: string; lineUrl: string; hours: string };
  social: { instagram: string; facebook: string; line: string };
  business: { name: string; taxId: string; address: string; foodRegNo: string; phone: string };
  demo: { bank: boolean; shipping: boolean };
}
export interface QuoteLine {
  key: string;
  variantId: string;
  slug: string;
  name: string;
  variantName: string;
  image: string | null;
  qty: number;
  unitPrice: string;
  lineTotal: string;
  discount: string;
  mode: "STOCK" | "PREORDER";
  shipDate: string;
  grind: { key: string; label: string } | null;
  bundle: Array<{ variantId: string; quantity: number; name: string }> | null;
}
export interface Quote {
  lines: QuoteLine[];
  itemsGross: string;
  discount: string;
  shippingFee: string;
  shippingWaived: boolean;
  freeShippingRemaining: string | null;
  total: string;
  promotions: Array<{ id: string; name: string; code: string | null; amount: string }>;
  couponError: string | null;
  estShipDate: string;
  hasPreorder: boolean;
  issues: Array<{ key: string; code: string; message: string }>;
  signature: string;
}

export const CATEGORY_LABEL: Record<string, string> = { beans: "咖啡豆", drip: "濾掛", gift: "禮盒", other: "其他" };
export const STATE_LABEL: Record<SaleState, string> = { IN_STOCK: "現貨", PREORDER: "預購", PREORDER_FULL: "預購額滿", SOLD_OUT: "售完", COMING_SOON: "即將推出" };

export const nt = (v: string | number | null | undefined) => (v == null || v === "" ? "" : `NT$ ${Number(v).toLocaleString("zh-TW")}`);
export const md = (ymd: string | null | undefined) => {
  if (!ymd) return "";
  const [, m, d] = ymd.slice(0, 10).split("-");
  return `${Number(m)}/${Number(d)}`;
};
export const twDateTime = (iso: string | null | undefined) => {
  if (!iso) return "";
  const t = new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString();
  return `${Number(t.slice(5, 7))}/${Number(t.slice(8, 10))} ${t.slice(11, 16)}`;
};

// ───────────── 購物車（訪客存瀏覽器；登入後同步到帳號） ─────────────

export interface CartLine {
  variantId: string;
  qty: number;
  grind?: string | null;
  bundle?: Array<{ variantId: string; qty: number }> | null;
}
export const lineKey = (l: Pick<CartLine, "variantId" | "grind" | "bundle">) => [l.variantId, l.grind || "WHOLE", (l.bundle ?? []).map((b) => `${b.variantId}x${b.qty}`).sort().join("+")].join("|");

const CART_KEY = "ata-shop-cart-v1";
export function readCart(): CartLine[] {
  try {
    const v = JSON.parse(localStorage.getItem(CART_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((l) => l && typeof l.variantId === "string" && Number.isInteger(l.qty) && l.qty > 0).slice(0, 50) : [];
  } catch {
    return [];
  }
}
export function writeCart(lines: CartLine[]) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(lines));
  } catch {
    /* 私密模式等：購物車只存在這次瀏覽 */
  }
}

/** LINE 登入起點（Cloud Function） */
export function lineStartUrl(returnTo: string, link?: string) {
  const emu = process.env.NEXT_PUBLIC_USE_EMULATORS === "1";
  const project = emu ? "demo-ata-coffee" : (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "ata-coffee");
  const base = emu ? `http://127.0.0.1:5001/${project}/asia-east1/lineAuth` : `https://asia-east1-${project}.cloudfunctions.net/lineAuth`;
  return `${base}/start?return=${encodeURIComponent(returnTo)}${link ? `&link=${encodeURIComponent(link)}` : ""}`;
}
export const isEmulator = process.env.NEXT_PUBLIC_USE_EMULATORS === "1";
