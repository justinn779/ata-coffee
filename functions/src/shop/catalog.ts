/**
 * 商城型錄與可售量（Available-to-Promise）。
 *
 * 可售量只用來「顯示」與結帳前提示；真正承諾庫存是在建立訂單的同一個交易裡實際保留（見 shop/orders.ts），
 * 因此不同規格共用同一批熟豆時，畫面上各自顯示「最多可買幾包」，下單時才從同一池扣保留，不會重複承諾。
 *
 * 規則：
 *  - 已分裝成品：AVAILABLE 批次、出貨日時距離賞味期限仍有 minShelfDaysAtShip 天以上
 *  - 接單後分裝：只看「單一」熟豆批次能裝幾包（不同批次零碎重量不合併），同時受包材可用量限制
 *  - 套組／禮盒：各組件可售量 ÷ 組件數量 取最小值，並受禮盒包材限制
 *  - 預購：預購活動期間不看實體庫存，只看配額（上限 − 待付款保留 − 已確認）
 */
import type { Firestore } from "firebase-admin/firestore";
import { D } from "../../../src/lib/decimal";
import { C, type InvLot } from "../types";
import type { Doc } from "../tx";
import { addDays, earliestShipDate, type StoreSettings } from "./settings";

type Filter = [string, "==" | "in" | "<=" | ">=" | "<" | ">" | "!=" | "array-contains", unknown];
/** 讀取介面：交易（Tx）與一般讀取共用同一套計價程式 */
export interface Reader {
  get<T extends Doc = Doc>(col: string, id: string): Promise<T | null>;
  query<T extends Doc = Doc>(col: string, filters: Filter[]): Promise<T[]>;
}

export function dbReader(db: Firestore): Reader {
  return {
    async get<T extends Doc = Doc>(col: string, id: string) {
      const s = await db.collection(col).doc(id).get();
      return s.exists ? ({ ...(s.data() as object), id } as T) : null;
    },
    async query<T extends Doc = Doc>(col: string, filters: Filter[]) {
      let q: FirebaseFirestore.Query = db.collection(col);
      for (const [f, op, v] of filters) q = q.where(f, op, v);
      return (await q.get()).docs.map((d) => ({ ...(d.data() as object), id: d.id }) as T);
    },
  };
}

export const STORE_CATEGORY: Record<string, "beans" | "drip" | "gift" | "other"> = { COFFEE_BEAN: "beans", DRIP_BAG: "drip", DRIP_BAG_SET: "drip", GIFT_BOX: "gift", MERCH: "other", OTHER: "other" };

export interface ProductStore {
  status?: "DRAFT" | "ACTIVE" | "HIDDEN" | "COMING_SOON";
  slug?: string;
  flavor?: string;
  summary?: string;
  images?: Array<{ url: string; alt?: string }>;
  details?: Array<{ title: string; body: string }>;
  grindable?: boolean;
  sortOrder?: number;
}
export interface CustomBundle {
  eligibleVariantIds: string[];
  min: number;
  max: number;
  allowRepeat: boolean;
  pricing: "FIXED" | "SUM_PLUS";
  extra?: string;
}

/** 一次讀進計算可售量需要的資料（批次、品項、預購活動） */
export interface CatalogModel {
  settings: StoreSettings;
  now: Date;
  products: Map<string, Doc>;
  variants: Map<string, Doc>;
  lotsByItem: Map<string, InvLot[]>;
  campaigns: Doc[];
}

export async function loadModel(r: Reader, settings: StoreSettings, opts?: { now?: Date; withLots?: boolean }): Promise<CatalogModel> {
  const products = new Map<string, Doc>();
  for (const st of ["ACTIVE", "COMING_SOON"]) for (const p of await r.query(C.products, [["store.status", "==", st]])) products.set(p.id, p);
  const variants = new Map<string, Doc>();
  for (const v of await r.query(C.variants, [["status", "==", "ACTIVE"]])) variants.set(v.id, v);
  const lotsByItem = new Map<string, InvLot[]>();
  // 建立訂單的交易不讀全部批次（避免鎖住所有庫存），庫存由實際保留檢查
  if (opts?.withLots !== false) for (const l of await r.query<InvLot>(C.lots, [["status", "==", "AVAILABLE"]])) {
    if (l.kind === "GREEN") continue;
    const arr = lotsByItem.get(l.itemId) ?? [];
    arr.push(l);
    lotsByItem.set(l.itemId, arr);
  }
  const campaigns = await r.query(C.preorders, [["status", "==", "ACTIVE"]]);
  return { settings, now: opts?.now ?? new Date(), products, variants, lotsByItem, campaigns };
}

export const lotUsable = (l: Pick<InvLot, "expiryDate">, shipDate: string, minShelfDays: number) => !l.expiryDate || String(l.expiryDate) >= addDays(shipDate, minShelfDays);
const avail = (l: InvLot) => D(l.onHand).sub(l.reserved);

/** 進行中的預購活動（時間內、狀態 ACTIVE） */
export function activeCampaign(m: CatalogModel, variantId: string) {
  const now = m.now.toISOString();
  return m.campaigns.find((c) => c.variantId === variantId && (!c.startAt || String(c.startAt) <= now) && (!c.endAt || String(c.endAt) >= now)) ?? null;
}
export const campaignRemaining = (c: Doc) => Math.max(0, Number(c.cap ?? 0) - Number(c.reservedQty ?? 0) - Number(c.confirmedQty ?? 0));

/** 單品（非套組）可售量：成品 + 接單後分裝能力（單一熟豆批次，受包材限制） */
export function unitAtp(m: CatalogModel, v: Doc, shipDate: string): { finished: number; mto: number; total: number } {
  if (v.stockPolicy === "NOT_TRACKED") return { finished: 999, mto: 0, total: 999 };
  const min = m.settings.minShelfDaysAtShip;
  const finished = (m.lotsByItem.get(`variant-${v.id}`) ?? []).filter((l) => lotUsable(l, shipDate, min)).reduce((s, l) => s + Math.max(0, Math.floor(avail(l).toNumber())), 0);
  let mto = 0;
  if (v.stockPolicy === "MADE_TO_ORDER" && v.coffeeId && v.fillWeightG && D(v.fillWeightG as string).gt(0)) {
    const fill = D(v.fillWeightG as string);
    for (const l of m.lotsByItem.get(`coffee-roasted-${v.coffeeId}`) ?? []) if (lotUsable(l, shipDate, min)) mto = Math.max(mto, Math.floor(avail(l).div(fill).toNumber()));
    mto = Math.min(mto, materialCap(m, v));
  }
  return { finished, mto: Math.max(0, mto), total: finished + Math.max(0, mto) };
}

/** 包材可支援的數量（BOM 每一項可用量 ÷ 每件用量，取最小） */
export function materialCap(m: CatalogModel, v: Doc) {
  let cap = Number.MAX_SAFE_INTEGER;
  for (const b of (v.materials as Array<{ materialId: string; quantityPerUnit: string }>) ?? []) {
    const per = D(b.quantityPerUnit);
    if (per.lte(0)) continue;
    const have = (m.lotsByItem.get(`material-${b.materialId}`) ?? []).reduce((s, l) => s.add(Decimal0(avail(l))), D(0));
    cap = Math.min(cap, Math.floor(have.div(per).toNumber()));
  }
  return cap;
}
const Decimal0 = (d: ReturnType<typeof D>) => (d.isNegative() ? D(0) : d);

/** 固定套組可售量 */
export function bundleAtp(m: CatalogModel, v: Doc, shipDate: string, components?: Array<{ variantId: string; quantity: number }>) {
  const comps = components ?? ((v.bundleComponents as Array<{ variantId: string; quantity: number }>) ?? []);
  if (!comps.length) return 0;
  let cap = materialCap(m, v);
  // 同一組件出現多次時合併需求
  const need = new Map<string, number>();
  for (const c of comps) need.set(c.variantId, (need.get(c.variantId) ?? 0) + Number(c.quantity));
  for (const [vid, q] of need) {
    const cv = m.variants.get(vid);
    if (!cv) return 0;
    cap = Math.min(cap, Math.floor(unitAtp(m, cv, shipDate).total / q));
  }
  return Math.max(0, cap);
}

export type SaleState = "IN_STOCK" | "PREORDER" | "PREORDER_FULL" | "SOLD_OUT" | "COMING_SOON";

export function variantState(m: CatalogModel, p: Doc, v: Doc) {
  const store = (p.store ?? {}) as ProductStore;
  const shipDate = earliestShipDate(m.settings, m.now);
  if (store.status === "COMING_SOON") return { state: "COMING_SOON" as SaleState, available: 0, shipDate: null as string | null, campaign: null as Doc | null };
  const c = activeCampaign(m, v.id);
  if (c) {
    const left = campaignRemaining(c);
    return { state: (left > 0 ? "PREORDER" : "PREORDER_FULL") as SaleState, available: left, shipDate: String(c.shipDate), campaign: c };
  }
  const cb = (v.store as { customBundle?: CustomBundle } | undefined)?.customBundle;
  let available: number;
  if (cb) {
    // 自選禮盒：可選商品的可售量合計，至少能湊滿最少數量才可購買
    let sum = 0;
    for (const id of cb.eligibleVariantIds) {
      const cv = m.variants.get(id);
      if (cv) sum += cb.allowRepeat ? unitAtp(m, cv, shipDate).total : Math.min(1, unitAtp(m, cv, shipDate).total);
    }
    available = Math.min(materialCap(m, v), Math.floor(sum / Math.max(1, cb.min)));
  } else available = v.isBundle ? bundleAtp(m, v, shipDate) : unitAtp(m, v, shipDate).total;
  return { state: (available > 0 ? "IN_STOCK" : "SOLD_OUT") as SaleState, available, shipDate, campaign: null };
}

const intStr = (v: unknown) => (v == null || v === "" ? null : String(D(v as string).toDecimalPlaces(0)));

/** 前台商品資料：只輸出公開欄位（不含成本、供應商、批次、SKU 內部資訊） */
export function publicProduct(m: CatalogModel, p: Doc, opts?: { detail?: boolean }) {
  const store = (p.store ?? {}) as ProductStore;
  const variants = [...m.variants.values()]
    .filter((v) => v.productId === p.id && (v.store as { visible?: boolean } | undefined)?.visible !== false)
    .sort((a, b) => Number((a.store as { sortOrder?: number })?.sortOrder ?? 0) - Number((b.store as { sortOrder?: number })?.sortOrder ?? 0) || D(a.salePrice as string).cmp(D(b.salePrice as string)));
  const vs = variants.map((v) => {
    const st = variantState(m, p, v);
    const cb = (v.store as { customBundle?: CustomBundle } | undefined)?.customBundle;
    return {
      id: v.id,
      name: v.name as string,
      price: intStr(v.salePrice),
      listPrice: D((v.listPrice as string) ?? 0).gt(D(v.salePrice as string)) ? intStr(v.listPrice) : null,
      weightG: v.fillWeightG ? Number(v.fillWeightG) : null,
      state: st.state,
      /** 只在數量少時顯示（避免透露庫存規模） */
      lowStock: st.state === "IN_STOCK" && st.available <= 5 ? st.available : null,
      maxQty: Math.max(0, Math.min(m.settings.maxQtyPerLine, st.available)),
      shipDate: st.shipDate,
      preorder: st.campaign ? { campaignId: st.campaign.id, shipDate: String(st.campaign.shipDate), endAt: (st.campaign.endAt as string) ?? null } : null,
      bundle: v.isBundle && !cb ? ((v.bundleComponents as Array<{ variantId: string; quantity: number }>) ?? []).map((c) => ({ name: componentName(m, c.variantId), quantity: c.quantity })) : null,
      customBundle: cb && opts?.detail ? customBundleView(m, cb) : cb ? { min: cb.min, max: cb.max } : null,
    };
  });
  const cat = STORE_CATEGORY[p.category as string] ?? "other";
  const prices = vs.map((v) => Number(v.price)).filter((x) => Number.isFinite(x));
  const order: SaleState[] = ["IN_STOCK", "PREORDER", "PREORDER_FULL", "COMING_SOON", "SOLD_OUT"];
  return {
    id: p.id,
    slug: store.slug || p.id,
    name: p.name as string,
    category: cat,
    flavor: store.flavor ?? null,
    summary: opts?.detail ? (store.summary ?? null) : null,
    images: (store.images ?? []).map((i) => ({ url: i.url, alt: i.alt || (p.name as string) })),
    details: opts?.detail ? (store.details ?? []).filter((d) => d.title && d.body) : [],
    grindable: cat === "beans" && store.grindable !== false,
    minPrice: prices.length ? String(Math.min(...prices)) : null,
    state: vs.map((v) => v.state).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] ?? "SOLD_OUT",
    variants: vs,
    sortOrder: store.sortOrder ?? 0,
    createdAt: p.createdAt ?? null,
  };
}

function componentName(m: CatalogModel, variantId: string) {
  const v = m.variants.get(variantId);
  return v ? `${v.productName}｜${v.name}` : "（已下架商品）";
}

function customBundleView(m: CatalogModel, cb: CustomBundle) {
  const shipDate = earliestShipDate(m.settings, m.now);
  return {
    min: cb.min,
    max: cb.max,
    allowRepeat: cb.allowRepeat,
    pricing: cb.pricing,
    extra: intStr(cb.extra ?? "0"),
    options: cb.eligibleVariantIds
      .map((id) => m.variants.get(id))
      .filter((v): v is Doc => !!v)
      .map((v) => {
        const p = m.products.get(v.productId as string);
        const a = unitAtp(m, v, shipDate).total;
        return { variantId: v.id, name: `${v.productName}｜${v.name}`, price: intStr(v.salePrice), image: ((p?.store as ProductStore | undefined)?.images ?? [])[0]?.url ?? null, available: Math.min(a, cb.allowRepeat ? cb.max : 1), soldOut: a <= 0 };
      }),
  };
}

export function listProducts(m: CatalogModel) {
  return [...m.products.values()].map((p) => publicProduct(m, p)).filter((p) => p.variants.length).sort((a, b) => a.sortOrder - b.sortOrder || String(b.createdAt).localeCompare(String(a.createdAt)));
}
