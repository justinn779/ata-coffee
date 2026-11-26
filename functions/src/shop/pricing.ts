/**
 * 商城計價（結帳報價與建立訂單共用；一律在後端計算）。
 *
 * 計算順序：商品小計 → 商品／組合優惠 → 訂單優惠 → 運費與免運判定 → 應付金額
 * 優惠組合（決定性，不受程式執行順序影響）：
 *   候選方案 =「所有可疊加優惠一起用」＋「每個不可疊加優惠單獨用」，取總折抵最多者；
 *   同額時取優先序最高者，再同則取優惠數較少者，最後依優惠 ID 字典序。
 * 金額單位：新台幣整數元（decimal.js 計算，存字串）；折扣不會讓商品金額小於 0。
 */
import { createHash } from "node:crypto";
import { D, type Decimal } from "../../../src/lib/decimal";
import { C } from "../types";
import type { Doc } from "../tx";
import { activeCampaign, campaignRemaining, type CatalogModel, type CustomBundle, type ProductStore, type Reader } from "./catalog";
import { earliestShipDate } from "./settings";
import { ShopError } from "./errors";

export interface CartLineInput {
  variantId: string;
  qty: number;
  grind?: string | null;
  bundle?: Array<{ variantId: string; qty: number }> | null;
}

export interface PricedLine {
  key: string;
  variant: Doc;
  product: Doc;
  qty: number;
  unitPrice: Decimal;
  gross: Decimal;
  discount: Decimal;
  mode: "STOCK" | "PREORDER";
  campaign: Doc | null;
  shipDate: string;
  grind: { key: string; label: string } | null;
  bundle: Array<{ variantId: string; quantity: number; name: string }> | null;
  name: string;
  image: string | null;
}

export interface AppliedPromo {
  id: string;
  name: string;
  code: string | null;
  type: string;
  amount: string;
}

export interface Quote {
  lines: PricedLine[];
  itemsGross: Decimal;
  itemDiscount: Decimal;
  orderDiscount: Decimal;
  merchandise: Decimal;
  shippingFee: Decimal;
  shippingWaived: boolean;
  freeShippingRemaining: Decimal | null;
  total: Decimal;
  promotions: AppliedPromo[];
  couponError: string | null;
  estShipDate: string;
  hasPreorder: boolean;
  issues: Array<{ key: string; code: string; message: string }>;
}

export const lineKey = (l: Pick<CartLineInput, "variantId" | "grind" | "bundle">) =>
  [l.variantId, l.grind || "WHOLE", (l.bundle ?? []).map((b) => `${b.variantId}x${b.qty}`).sort().join("+")].join("|");

const int = (d: Decimal) => d.toDecimalPlaces(0, 1 /* ROUND_DOWN */);

/** 驗證並計價每一行（不檢查實體庫存；庫存在建立訂單時實際保留） */
export async function priceCart(r: Reader, m: CatalogModel, input: CartLineInput[], opts?: { strict?: boolean }) {
  const s = m.settings;
  const merged = new Map<string, CartLineInput>();
  for (const l of input) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) continue;
    const k = lineKey(l);
    const prev = merged.get(k);
    merged.set(k, { ...l, qty: (prev?.qty ?? 0) + l.qty });
  }
  const lines: PricedLine[] = [];
  const issues: Quote["issues"] = [];
  const fail = (key: string, code: string, message: string) => {
    if (opts?.strict) throw new ShopError(code as never, message, { key });
    issues.push({ key, code, message });
  };
  const baseShip = earliestShipDate(s, m.now);
  for (const [key, l] of merged) {
    const v = await r.get(C.variants, l.variantId);
    const p = v ? await r.get(C.products, v.productId as string) : null;
    const pstore = (p?.store ?? {}) as ProductStore;
    if (!v || !p || v.status !== "ACTIVE" || pstore.status !== "ACTIVE" || p.status === "ARCHIVED" || (v.store as { visible?: boolean } | undefined)?.visible === false) {
      fail(key, "PRODUCT_UNAVAILABLE", `${v ? `${v.productName}｜${v.name}` : "商品"} 已下架`);
      continue;
    }
    if (l.qty > s.maxQtyPerLine) {
      fail(key, "INSUFFICIENT_STOCK", `每項商品一次最多 ${s.maxQtyPerLine} 件`);
      continue;
    }
    // 研磨：只有咖啡豆、且商品允許研磨時可選；預設原豆
    let grind: PricedLine["grind"] = null;
    if (l.grind && l.grind !== "WHOLE") {
      const g = s.grindOptions.find((x) => x.key === l.grind && x.enabled);
      if (!g || p.category !== "COFFEE_BEAN" || pstore.grindable === false) {
        fail(key, "PRODUCT_UNAVAILABLE", "這個研磨選項目前無法提供");
        continue;
      }
      grind = { key: g.key, label: g.label };
    }
    // 自選禮盒
    const cb = (v.store as { customBundle?: CustomBundle } | undefined)?.customBundle;
    let unitPrice = D(v.salePrice as string);
    let bundle: PricedLine["bundle"] = null;
    if (cb) {
      const sel = (l.bundle ?? []).filter((b) => b.qty > 0);
      const count = sel.reduce((n, b) => n + b.qty, 0);
      const bad = (msg: string) => fail(key, "INVALID_BUNDLE", msg);
      if (count < cb.min || count > cb.max) {
        bad(cb.min === cb.max ? `請選滿 ${cb.min} 件` : `請選 ${cb.min}–${cb.max} 件`);
        continue;
      }
      if (!cb.allowRepeat && sel.some((b) => b.qty > 1)) {
        bad("這個禮盒每種商品只能選一件");
        continue;
      }
      let sum = D(0);
      bundle = [];
      let ok = true;
      for (const b of sel) {
        const cv = cb.eligibleVariantIds.includes(b.variantId) ? await r.get(C.variants, b.variantId) : null;
        if (!cv || cv.status !== "ACTIVE" || cv.isBundle) {
          bad("禮盒裡有商品已無法選擇，請重新挑選");
          ok = false;
          break;
        }
        sum = sum.add(D(cv.salePrice as string).mul(b.qty));
        bundle.push({ variantId: cv.id, quantity: b.qty, name: `${cv.productName}｜${cv.name}` });
      }
      if (!ok) continue;
      unitPrice = cb.pricing === "SUM_PLUS" ? sum.add(cb.extra ?? 0) : unitPrice;
    } else if (l.bundle?.length) {
      fail(key, "INVALID_BUNDLE", "這個商品不是自選禮盒");
      continue;
    }
    unitPrice = int(unitPrice);
    const campaign = activeCampaign(m, v.id);
    if (campaign && campaignRemaining(campaign) < l.qty) {
      fail(key, "PREORDER_SOLD_OUT", campaignRemaining(campaign) > 0 ? `預購只剩 ${campaignRemaining(campaign)} 件` : "預購已額滿");
      continue;
    }
    lines.push({
      key,
      variant: v,
      product: p,
      qty: l.qty,
      unitPrice,
      gross: unitPrice.mul(l.qty),
      discount: D(0),
      mode: campaign ? "PREORDER" : "STOCK",
      campaign,
      shipDate: campaign ? String(campaign.shipDate) : baseShip,
      grind,
      bundle,
      name: `${p.name}｜${v.name}`,
      image: (pstore.images ?? [])[0]?.url ?? null,
    });
  }
  return { lines, issues };
}

// ───────────── 優惠 ─────────────

interface PromoDoc extends Doc {
  name: string;
  code?: string | null;
  active: boolean;
  startAt?: string | null;
  endAt?: string | null;
  type: "AMOUNT" | "PERCENT" | "FREE_SHIPPING" | "COMBO";
  value?: string | null;
  appliesTo: "ALL" | "PRODUCTS";
  productIds?: string[];
  variantIds?: string[];
  minSpend?: string | null;
  comboQty?: number | null;
  usageLimit?: number | null;
  usedCount?: number;
  perCustomerLimit?: number | null;
  priority?: number;
  stackable: boolean;
  maxDiscount?: string | null;
}

const eligible = (p: PromoDoc, l: PricedLine) => p.appliesTo === "ALL" || (p.productIds ?? []).includes(l.product.id) || (p.variantIds ?? []).includes(l.variant.id);
const isItemLevel = (p: PromoDoc) => p.type === "COMBO" || (p.appliesTo === "PRODUCTS" && p.type !== "FREE_SHIPPING");

/** 把折扣依各行剩餘金額比例分攤（整數元，餘數給金額最大的行；不讓任一行變負） */
function allocate(lines: PricedLine[], remain: Map<string, Decimal>, amount: Decimal) {
  const total = lines.reduce((s, l) => s.add(remain.get(l.key)!), D(0));
  if (total.lte(0) || amount.lte(0)) return new Map<string, Decimal>();
  const out = new Map<string, Decimal>();
  let used = D(0);
  for (const l of lines) {
    const part = int(amount.mul(remain.get(l.key)!).div(total));
    out.set(l.key, part);
    used = used.add(part);
  }
  let rest = amount.sub(used);
  const order = [...lines].sort((a, b) => remain.get(b.key)!.cmp(remain.get(a.key)!) || a.key.localeCompare(b.key));
  for (const l of order) {
    if (rest.lte(0)) break;
    const room = remain.get(l.key)!.sub(out.get(l.key)!);
    const add = Decimal_min(room, rest);
    out.set(l.key, out.get(l.key)!.add(add));
    rest = rest.sub(add);
  }
  return out;
}
const Decimal_min = (a: Decimal, b: Decimal) => (a.lt(b) ? a : b);

function evaluate(set: PromoDoc[], lines: PricedLine[], shippingFee: Decimal, freeThreshold: Decimal | null, freeBasis: string) {
  const remain = new Map(lines.map((l) => [l.key, l.gross]));
  const perLine = new Map(lines.map((l) => [l.key, D(0)]));
  const applied: AppliedPromo[] = [];
  const sorted = [...set].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));
  const apply = (p: PromoDoc, ls: PricedLine[]) => {
    const base = ls.reduce((s, l) => s.add(remain.get(l.key)!), D(0));
    let d = D(0);
    if (p.type === "AMOUNT") d = D(p.value ?? 0);
    else if (p.type === "PERCENT") d = int(base.mul(D(p.value ?? 0)).div(100));
    else if (p.type === "COMBO") {
      const qty = ls.reduce((n, l) => n + l.qty, 0);
      d = D(p.value ?? 0).mul(Math.floor(qty / Math.max(1, p.comboQty ?? 2)));
    }
    if (p.maxDiscount) d = Decimal_min(d, D(p.maxDiscount));
    d = Decimal_min(int(d), base);
    if (d.lte(0)) return;
    for (const [k, part] of allocate(ls, remain, d)) {
      remain.set(k, remain.get(k)!.sub(part));
      perLine.set(k, perLine.get(k)!.add(part));
    }
    applied.push({ id: p.id, name: p.name, code: p.code ?? null, type: p.type, amount: d.toFixed(0) });
  };
  for (const p of sorted.filter(isItemLevel)) apply(p, lines.filter((l) => eligible(p, l)));
  const afterItems = [...remain.values()].reduce((s, x) => s.add(x), D(0));
  for (const p of sorted.filter((x) => !isItemLevel(x) && x.type !== "FREE_SHIPPING")) apply(p, lines);
  const merchandise = [...remain.values()].reduce((s, x) => s.add(x), D(0));
  const gross = lines.reduce((s, l) => s.add(l.gross), D(0));
  const basis = freeBasis === "SUBTOTAL" ? gross : merchandise;
  let waived = !!freeThreshold && basis.gte(freeThreshold);
  const fs = sorted.find((p) => p.type === "FREE_SHIPPING");
  if (fs && !waived && shippingFee.gt(0)) {
    waived = true;
    applied.push({ id: fs.id, name: fs.name, code: fs.code ?? null, type: fs.type, amount: shippingFee.toFixed(0) });
  }
  const shipping = waived ? D(0) : shippingFee;
  const saving = gross.sub(merchandise).add(shippingFee.sub(shipping));
  return { perLine, applied, itemDiscount: gross.sub(afterItems), orderDiscount: afterItems.sub(merchandise), merchandise, shipping, waived, basis, saving, maxPriority: Math.max(-1e9, ...set.map((p) => p.priority ?? 0)) };
}

export async function loadPromotions(r: Reader, now: Date) {
  const iso = now.toISOString();
  return (await r.query<PromoDoc>(C.promotions, [["active", "==", true]])).filter((p) => (!p.startAt || p.startAt <= iso) && (!p.endAt || p.endAt >= iso));
}

/** 顧客已使用次數（每人限用） */
async function usedBy(r: Reader, promoId: string, customerKey: string | null) {
  if (!customerKey) return 0;
  return (await r.query(C.redemptions, [["promoId", "==", promoId], ["customerKey", "==", customerKey]])).filter((x) => x.status === "ACTIVE").length;
}

export async function buildQuote(r: Reader, m: CatalogModel, input: { lines: CartLineInput[]; couponCode?: string | null; customerKey?: string | null }, opts?: { strict?: boolean }): Promise<Quote> {
  const s = m.settings;
  const { lines, issues } = await priceCart(r, m, input.lines, opts);
  const itemsGross = lines.reduce((t, l) => t.add(l.gross), D(0));
  const shippingFee = lines.length ? int(D(s.shipping.fee || 0)) : D(0);
  const freeThreshold = s.shipping.freeThreshold ? D(s.shipping.freeThreshold) : null;

  // 可用優惠
  const code = input.couponCode?.trim().toUpperCase() || null;
  let couponError: string | null = null;
  const pool: PromoDoc[] = [];
  const promos = await loadPromotions(r, m.now);
  if (code && !promos.some((p) => p.code && p.code.toUpperCase() === code)) couponError = "折扣碼無效或已過期";
  for (const p of promos) {
    const isCode = !!p.code;
    if (isCode && p.code!.toUpperCase() !== code) continue;
    const why = (msg: string) => {
      if (isCode) couponError = msg;
    };
    if (p.usageLimit != null && (p.usedCount ?? 0) >= p.usageLimit) {
      why("折扣碼已被用完");
      continue;
    }
    if (p.perCustomerLimit != null && (await usedBy(r, p.id, input.customerKey ?? null)) >= p.perCustomerLimit) {
      why("你已經使用過這個折扣碼");
      continue;
    }
    const scoped = lines.filter((l) => eligible(p, l));
    if (!scoped.length) {
      why("購物車裡沒有適用這個折扣碼的商品");
      continue;
    }
    const spend = p.appliesTo === "ALL" ? itemsGross : scoped.reduce((t, l) => t.add(l.gross), D(0));
    if (p.minSpend && spend.lt(p.minSpend)) {
      why(`再買 NT$${D(p.minSpend).sub(spend).toFixed(0)} 才能使用這個折扣碼`);
      continue;
    }
    if (p.type === "COMBO" && scoped.reduce((n, l) => n + l.qty, 0) < Math.max(1, p.comboQty ?? 2)) {
      why(`適用商品要買 ${p.comboQty ?? 2} 件才有組合優惠`);
      continue;
    }
    pool.push(p);
  }
  // 候選方案：可疊加的全部一起、每個不可疊加的單獨
  const candidates: PromoDoc[][] = [[]];
  const stackable = pool.filter((p) => p.stackable);
  if (stackable.length) candidates.push(stackable);
  for (const p of pool.filter((x) => !x.stackable)) candidates.push([p]);
  let best = evaluate([], lines, shippingFee, freeThreshold, s.shipping.freeBasis);
  let bestSet: PromoDoc[] = [];
  for (const set of candidates.slice(1)) {
    const e = evaluate(set, lines, shippingFee, freeThreshold, s.shipping.freeBasis);
    const better = e.saving.gt(best.saving) || (e.saving.eq(best.saving) && e.saving.gt(0) && (e.maxPriority > best.maxPriority || (e.maxPriority === best.maxPriority && (set.length < bestSet.length || (set.length === bestSet.length && set.map((p) => p.id).join() < bestSet.map((p) => p.id).join())))));
    if (better) {
      best = e;
      bestSet = set;
    }
  }
  if (code && !couponError && !best.applied.some((a) => a.code?.toUpperCase() === code)) couponError = "這個折扣碼不能和目前的優惠一起使用，已幫你套用較划算的方案";
  for (const l of lines) l.discount = best.perLine.get(l.key) ?? D(0);
  const estShipDate = lines.reduce((mx, l) => (l.shipDate > mx ? l.shipDate : mx), earliestShipDate(s, m.now));
  return {
    lines,
    itemsGross,
    itemDiscount: best.itemDiscount,
    orderDiscount: best.orderDiscount,
    merchandise: best.merchandise,
    shippingFee: best.shipping,
    shippingWaived: best.waived && shippingFee.gt(0),
    freeShippingRemaining: freeThreshold && !best.waived && lines.length ? freeThreshold.sub(best.basis) : null,
    total: best.merchandise.add(best.shipping),
    promotions: best.applied,
    couponError,
    estShipDate,
    hasPreorder: lines.some((l) => l.mode === "PREORDER"),
    issues,
  };
}

/** 報價簽章：價格、優惠、運費、出貨日任一改變，建立訂單時要求顧客重新確認 */
export const quoteSignature = (q: Quote) =>
  createHash("sha256")
    .update(JSON.stringify([q.lines.map((l) => [l.key, l.qty, l.unitPrice.toFixed(0), l.discount.toFixed(0), l.mode]), q.shippingFee.toFixed(0), q.total.toFixed(0), q.estShipDate]))
    .digest("hex")
    .slice(0, 16);

/** 前台報價輸出 */
export function publicQuote(q: Quote) {
  return {
    lines: q.lines.map((l) => ({ key: l.key, variantId: l.variant.id, slug: ((l.product.store as ProductStore)?.slug as string) || l.product.id, name: l.product.name as string, variantName: l.variant.name as string, image: l.image, qty: l.qty, unitPrice: l.unitPrice.toFixed(0), lineTotal: l.gross.sub(l.discount).toFixed(0), discount: l.discount.toFixed(0), mode: l.mode, shipDate: l.shipDate, grind: l.grind, bundle: l.bundle })),
    itemsGross: q.itemsGross.toFixed(0),
    discount: q.itemDiscount.add(q.orderDiscount).toFixed(0),
    shippingFee: q.shippingFee.toFixed(0),
    shippingWaived: q.shippingWaived,
    freeShippingRemaining: q.freeShippingRemaining && q.freeShippingRemaining.gt(0) ? q.freeShippingRemaining.toFixed(0) : null,
    total: q.total.toFixed(0),
    promotions: q.promotions,
    couponError: q.couponError,
    estShipDate: q.estShipDate,
    hasPreorder: q.hasPreorder,
    issues: q.issues,
    signature: quoteSignature(q),
  };
}
