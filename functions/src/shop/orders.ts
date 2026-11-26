/**
 * 商城訂單：建立（同一交易內完成商品、價格、優惠、庫存、預購配額驗證與保留）、付款回報、顧客取消、逾期處理、
 * 預購分配、物流狀態、訪客存取權杖。共用後台的訂單、庫存、分裝、成本邏輯（domain/*）。
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { D, money, toDb } from "../../../src/lib/decimal";
import { nowIso, type Doc, type Tx } from "../tx";
import { C, type Actor, type InvLot } from "../types";
import { audit, getSettings, nextNumber } from "../domain/core";
import { allocateLotToItem, refreshFulfillment, refreshItemCostSnapshot, requiredUnits, type OrderItemDoc } from "../domain/allocation";
import { availableLots, availableOf, ensureCoffeeItem, ensureMaterialItem, ensureVariantItem, reserve } from "../domain/inventory";
import { createProductionOrder } from "../domain/production";
import { cancelOrder, orderHooks, statusEvent } from "../domain/orders";
import { loadModel, lotUsable, type Reader } from "./catalog";
import { buildQuote, publicQuote, quoteSignature, type CartLineInput, type PricedLine } from "./pricing";
import { storeSettings, type StoreSettings } from "./settings";
import { ShopError } from "./errors";
import { enqueue } from "./outbox";

/** 更新訂單的商城欄位（store 物件整體合併寫回） */
export async function patchStore(tx: Tx, orderId: string, patch: Record<string, unknown>) {
  const o = await tx.must(C.orders, orderId, "訂單");
  await tx.update(C.orders, orderId, { store: { ...((o.store as Record<string, unknown>) ?? {}), ...patch }, updatedAt: nowIso() });
}

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");

export interface PickupInput {
  carrier: "SEVEN" | "FAMILY";
  storeId: string;
  storeName: string;
  storeAddress?: string | null;
}
export interface CreateStoreOrderInput {
  lines: CartLineInput[];
  couponCode?: string | null;
  contact: { name: string; phone: string; email: string };
  pickup: PickupInput;
  note?: string | null;
  signature: string;
  idempotencyKey: string;
  saveProfile?: boolean;
}
export interface Who {
  uid: string | null;
  email?: string | null;
  emailVerified?: boolean;
}

export const customerKey = (who: Who, email: string) => (who.uid ? `uid:${who.uid}` : `email:${email.trim().toLowerCase()}`);

export function validatePickup(s: StoreSettings, p: PickupInput) {
  const ch = s.pickupChannels.find((c) => c.key === p.carrier && c.enabled);
  if (!ch) throw new ShopError("INVALID_PICKUP_STORE", "請選擇取貨的超商");
  // 7-ELEVEN 店號 6 碼、全家店號 6 碼（人工流程：顧客從官方門市查詢頁取得）
  if (!/^\d{6}$/.test(p.storeId.trim())) throw new ShopError("INVALID_PICKUP_STORE", "門市店號是 6 位數字，可在超商官方門市查詢找到");
  if (!p.storeName.trim() || p.storeName.trim().length > 40) throw new ShopError("INVALID_PICKUP_STORE", "請填寫門市名稱");
  return { carrier: p.carrier, carrierLabel: ch.label, storeId: p.storeId.trim(), storeName: p.storeName.trim().replace(/門市$/, ""), storeAddress: p.storeAddress?.trim() || null, source: "MANUAL", verified: false };
}

// ───────────── 訪客存取權杖 ─────────────

/** 發給訂單專屬存取權杖（只存雜湊；可撤銷；有效期限） */
export function issueAccess(tx: Tx, orderId: string, kind: "LINK" | "VERIFIED", days: number) {
  const raw = token();
  tx.set(C.orderAccess, sha(raw), { orderId, kind, expiresAt: new Date(Date.now() + days * 86400_000).toISOString(), revokedAt: null, createdAt: nowIso() });
  return raw;
}

export async function orderByToken(r: Reader, raw: string) {
  if (!raw || raw.length < 20 || raw.length > 100) throw new ShopError("UNAUTHORIZED_ORDER_ACCESS", "訂單連結無效，請用訂單編號與 Email 重新查詢");
  const a = await r.get(C.orderAccess, sha(raw));
  if (!a || a.revokedAt || String(a.expiresAt) < nowIso()) throw new ShopError("UNAUTHORIZED_ORDER_ACCESS", "訂單連結已過期，請用訂單編號與 Email 重新查詢");
  const o = await r.get(C.orders, a.orderId as string);
  if (!o) throw new ShopError("UNAUTHORIZED_ORDER_ACCESS", "找不到訂單");
  return o;
}

/** 顧客取得訂單：會員看自己的訂單，訪客用存取權杖 */
export async function authorizeOrder(r: Reader, who: Who, ref: { token?: string | null; orderId?: string | null }) {
  if (ref.token) return orderByToken(r, ref.token);
  if (ref.orderId && who.uid) {
    const o = await r.get(C.orders, ref.orderId);
    if (o && o.customerUid === who.uid) return o;
  }
  throw new ShopError("UNAUTHORIZED_ORDER_ACCESS", "沒有權限查看這筆訂單");
}

// ───────────── 建立訂單 ─────────────

export async function createStoreOrder(tx: Tx, input: CreateStoreOrderInput, who: Who, actor: Actor) {
  const idemId = "storeorder-" + sha(input.idempotencyKey).slice(0, 40);
  const idem = await tx.get(C.uniq, idemId);
  if (idem) {
    const o = await tx.must(C.orders, idem.orderId as string, "訂單");
    return { order: o, token: issueAccess(tx, o.id, "LINK", 60), duplicate: true };
  }
  const s = await storeSettings(tx);
  if (!s.open || s.maintenance) throw new ShopError("STORE_CLOSED", s.maintenanceMessage || "商城暫停接單，請稍後再來");
  const pickup = validatePickup(s, input.pickup);
  const email = input.contact.email.trim().toLowerCase();
  const cKey = customerKey(who, email);
  const model = await loadModel(tx, s, { withLots: false });
  const q = await buildQuote(tx, model, { lines: input.lines, couponCode: input.couponCode, customerKey: cKey }, { strict: true });
  if (!q.lines.length) throw new ShopError("PRODUCT_UNAVAILABLE", "購物車是空的");
  if (input.couponCode?.trim() && q.couponError && !q.promotions.some((p) => p.code?.toUpperCase() === input.couponCode!.trim().toUpperCase())) throw new ShopError("PROMOTION_INVALID", q.couponError, { quote: publicQuote(q) });
  if (quoteSignature(q) !== input.signature) throw new ShopError("PRICE_CHANGED", "價格、優惠或出貨日有更新，請確認後再送出", { quote: publicQuote(q) });

  const base = await getSettings(tx);
  const taxRate = D(base.tax.rate);
  const now = nowIso();
  const orderNo = await nextNumber(tx, "SO");
  const deadline = new Date(Date.now() + s.paymentDeadlineHours * 3600_000).toISOString();
  const lineTotals = q.lines.map((l) => money(l.gross.sub(l.discount)));
  const subtotal = lineTotals.reduce((a, b) => a.add(b), D(0));
  const taxOf = (t: ReturnType<typeof D>) => (base.tax.mode === "INCLUSIVE" ? money(t.sub(t.div(taxRate.add(1)))) : base.tax.mode === "EXCLUSIVE" ? money(t.mul(taxRate)) : D(0));
  const taxTotal = lineTotals.reduce((a, t) => a.add(taxOf(t)), D(0));
  const total = subtotal.add(base.tax.mode === "EXCLUSIVE" ? taxTotal : 0).add(q.shippingFee);
  const order = tx.create(C.orders, {
    orderNo,
    channel: "STORE",
    externalRef: null,
    customerId: null,
    customerUid: who.uid,
    customerKey: cKey,
    customerName: input.contact.name.trim(),
    customerPhone: input.contact.phone.trim(),
    customerEmail: email,
    shippingAddress: `${pickup.carrierLabel} ${pickup.storeName}門市（${pickup.storeId}）`,
    shippingMethod: `${pickup.carrierLabel} 取貨`,
    orderedAt: now,
    paymentStatus: "UNPAID",
    fulfillmentStatus: "PENDING",
    taxMode: base.tax.mode,
    taxRate: toDb(taxRate, 4),
    subtotal: toDb(subtotal, 2),
    discountTotal: toDb(q.itemDiscount.add(q.orderDiscount), 2),
    taxTotal: toDb(taxTotal, 2),
    shippingFee: toDb(q.shippingFee, 2),
    total: toDb(total, 2),
    refundedTotal: "0.00",
    note: input.note?.trim() || null,
    paidAt: null,
    cancelledAt: null,
    completedAt: null,
    shipment: null,
    store: {
      itemsGross: toDb(q.itemsGross, 2),
      itemDiscount: toDb(q.itemDiscount, 2),
      orderDiscount: toDb(q.orderDiscount, 2),
      shippingWaived: q.shippingWaived,
      promotions: q.promotions,
      couponCode: input.couponCode?.trim().toUpperCase() || null,
      pickup,
      estShipDate: q.estShipDate,
      originalEstShipDate: q.estShipDate,
      hasPreorder: q.hasPreorder,
      paymentDeadline: deadline,
      bank: { ...s.bank },
      reminderSentAt: null,
      needsReview: false,
    },
    createdAt: now,
    updatedAt: now,
  });
  tx.set(C.uniq, idemId, { kind: "storeOrderIdempotency", orderId: order.id, at: now });

  for (let i = 0; i < q.lines.length; i++) await createStoreItem(tx, order, q.lines[i], lineTotals[i], taxOf(lineTotals[i]), s, actor);
  await refreshFulfillment(tx, order.id);

  // 優惠使用次數（同一交易內檢查上限，避免併發超用）
  for (const p of q.promotions) {
    const promo = await tx.must(C.promotions, p.id, "優惠");
    if (promo.usageLimit != null && Number(promo.usedCount ?? 0) >= Number(promo.usageLimit)) throw new ShopError("PROMOTION_INVALID", `「${promo.name}」已被用完，請重新確認`, { quote: null });
    await tx.update(C.promotions, promo.id, { usedCount: Number(promo.usedCount ?? 0) + 1 });
    tx.create(C.redemptions, { promoId: promo.id, promoName: promo.name, code: promo.code ?? null, orderId: order.id, orderNo, customerKey: cKey, amount: p.amount, status: "ACTIVE", createdAt: now, releasedAt: null });
  }

  if (who.uid && input.saveProfile) await saveProfileFromOrder(tx, who.uid, input.contact, pickup);
  statusEvent(tx, order.id, "orderStatus", null, "CREATED", actor, "商城下單");
  const raw = issueAccess(tx, order.id, "LINK", 60);
  await enqueue(tx, `order-created-${order.id}`, { to: email, template: "ORDER_CREATED", orderId: order.id, data: { token: raw } });
  audit(tx, actor, "store.order.create", "SalesOrder", order.id, `商城訂單 ${orderNo}，金額 ${total.toFixed(0)}`);
  return { order: await tx.must(C.orders, order.id, "訂單"), token: raw, duplicate: false };
}

async function createStoreItem(tx: Tx, order: Doc, l: PricedLine, lineTotal: ReturnType<typeof D>, tax: ReturnType<typeof D>, s: StoreSettings, actor: Actor) {
  const v = l.variant;
  const bundleComponents = l.bundle ? l.bundle.map((b) => ({ variantId: b.variantId, quantity: b.quantity, name: b.name })) : ((v.bundleComponents as Array<{ variantId: string; quantity: number }>) ?? []).map((c) => ({ variantId: c.variantId, quantity: c.quantity }));
  const oi = tx.create(C.orderItems, {
    orderId: order.id,
    orderNo: order.orderNo,
    variantId: v.id,
    productId: l.product.id,
    skuSnapshot: v.sku,
    nameSnapshot: l.name,
    imageSnapshot: l.image,
    quantity: l.qty,
    unitPriceSnapshot: toDb(l.unitPrice, 2),
    discount: toDb(l.discount, 2),
    taxAmount: toDb(tax, 2),
    lineTotal: toDb(lineTotal, 2),
    costSnapshot: null,
    isBundle: !!v.isBundle,
    bundleComponents,
    customBundle: !!l.bundle,
    grind: l.grind,
    lineKey: l.key,
    fulfillmentMode: l.mode === "PREORDER" ? "PREORDER" : "STOCK",
    campaignId: l.campaign?.id ?? null,
    preorderState: l.mode === "PREORDER" ? "RESERVED" : null,
    shipDateSnapshot: l.shipDate,
    orderedAt: order.orderedAt,
  }) as unknown as OrderItemDoc;
  if (l.mode === "PREORDER") {
    // 預購配額（與實體庫存分開；同一交易讀取活動文件 → 併發時序列化，不會超過上限）
    const c = await tx.must(C.preorders, l.campaign!.id, "預購活動");
    const left = Number(c.cap ?? 0) - Number(c.reservedQty ?? 0) - Number(c.confirmedQty ?? 0);
    if (c.status !== "ACTIVE" || left < l.qty) throw new ShopError("PREORDER_SOLD_OUT", left > 0 ? `${l.name} 預購只剩 ${left} 件` : `${l.name} 預購已額滿`, { key: l.key, available: Math.max(0, left) });
    await tx.update(C.preorders, c.id, { reservedQty: Number(c.reservedQty ?? 0) + l.qty });
    return;
  }
  let usedMto = false;
  for (const need of requiredUnits(oi)) {
    const cv = need.variantId === v.id ? v : await tx.must(C.variants, need.variantId, "組件");
    usedMto = (await reserveUnits(tx, { order, item: oi, line: l, shipDate: l.shipDate, s, actor }, cv, need.qty.toNumber())) || usedMto;
  }
  // 套組的禮盒包材：下單時預留，出貨時扣除（成本計入此明細）
  if (v.isBundle) for (const b of (v.materials as Array<{ materialId: string; quantityPerUnit: string; materialName?: string }>) ?? []) {
    const item = await ensureMaterialItem(tx, b.materialId);
    let left = D(b.quantityPerUnit).mul(l.qty);
    const lots = await availableLots(tx, item.id);
    if (lots.reduce((t, x) => t.add(availableOf(x)), D(0)).lt(left)) throw new ShopError("INSUFFICIENT_STOCK", `${l.name} 的禮盒包材不足，暫時無法購買`, { key: l.key, available: 0 });
    for (const lot of lots) {
      if (left.lte(0)) break;
      const take = availableOf(lot).lt(left) ? availableOf(lot) : left;
      await allocateLotToItem(tx, { orderId: order.id, orderItemId: oi.id, variantId: `material:${b.materialId}`, sku: b.materialName ?? item.name, lot, qty: take });
      left = left.sub(take);
    }
  }
  if (usedMto && !v.isBundle) await tx.update(C.orderItems, oi.id, { fulfillmentMode: "MADE_TO_ORDER" });
  await refreshItemCostSnapshot(tx, oi.id);
}

/**
 * 保留一個單品的需求：先用符合出貨日品質期限的已分裝成品（FIFO），不足時接單後分裝：
 * 只能用「單一」熟豆批次（不混豆），並預留包材；都不夠就拒絕（商城不超賣）。回傳是否使用接單後分裝。
 */
async function reserveUnits(tx: Tx, ctx: { order: Doc; item: OrderItemDoc; line: PricedLine; shipDate: string; s: StoreSettings; actor: Actor }, cv: Doc, qty: number) {
  const min = ctx.s.minShelfDaysAtShip;
  const name = `${cv.productName}｜${cv.name}`;
  if (cv.stockPolicy === "NOT_TRACKED") return false;
  const fg = await ensureVariantItem(tx, cv.id);
  const lots = (await availableLots(tx, fg.id)).filter((l) => lotUsable(l, ctx.shipDate, min));
  let left = qty;
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(Math.floor(availableOf(lot).toNumber()), left);
    if (take <= 0) continue;
    await allocateLotToItem(tx, { orderId: ctx.order.id, orderItemId: ctx.item.id, variantId: cv.id, sku: cv.sku as string, lot, qty: D(take) });
    left -= take;
  }
  if (left <= 0) return false;
  const have = qty - left;
  const short = () => new ShopError("INSUFFICIENT_STOCK", have > 0 ? `${name} 目前只剩 ${have} 件` : `${name} 已售完`, { key: ctx.line.key, available: have });
  if (cv.stockPolicy !== "MADE_TO_ORDER" || !cv.coffeeId || !cv.fillWeightG) throw short();
  const fill = D(cv.fillWeightG as string);
  const roasted = await ensureCoffeeItem(tx, cv.coffeeId as string, "ROASTED");
  const need = fill.mul(left);
  const src = (await availableLots(tx, roasted.id)).filter((l) => lotUsable(l, ctx.shipDate, min)).find((l) => availableOf(l).gte(need));
  if (!src) throw short();
  const bom = (cv.materials as Array<{ materialId: string; quantityPerUnit: string }>) ?? [];
  const matLots: Array<{ lots: InvLot[]; need: ReturnType<typeof D> }> = [];
  for (const b of bom) {
    const it = await ensureMaterialItem(tx, b.materialId);
    const ls = await availableLots(tx, it.id);
    const n = D(b.quantityPerUnit).mul(left);
    if (ls.reduce((t, x) => t.add(availableOf(x)), D(0)).lt(n)) throw short();
    matLots.push({ lots: ls, need: n });
  }
  const po = await createProductionOrder(tx, { sourceLotId: src.id, targetVariantId: cv.id, plannedQty: left, plannedDate: ctx.shipDate, mode: "MADE_TO_ORDER", orderItemId: ctx.item.id, orderId: ctx.order.id, note: `商城訂單 ${ctx.order.orderNo} 接單後分裝` }, ctx.actor);
  for (const m of matLots) {
    let rest = m.need;
    for (const lot of m.lots) {
      if (rest.lte(0)) break;
      const fresh = await tx.must<InvLot>(C.lots, lot.id, "包材批次");
      const take = availableOf(fresh).lt(rest) ? availableOf(fresh) : rest;
      if (take.lte(0)) continue;
      await reserve(tx, { lotId: lot.id, quantity: take, purpose: "PRODUCTION", productionOrderId: po.id, note: `包材預留 ${po.orderNo}` });
      rest = rest.sub(take);
    }
  }
  return true;
}

async function saveProfileFromOrder(tx: Tx, uid: string, contact: CreateStoreOrderInput["contact"], pickup: ReturnType<typeof validatePickup>) {
  const c = await tx.get(C.shopCustomers, uid);
  const stores = ((c?.savedStores as Array<Record<string, unknown>>) ?? []).filter((x) => !(x.carrier === pickup.carrier && x.storeId === pickup.storeId));
  const next = [{ carrier: pickup.carrier, carrierLabel: pickup.carrierLabel, storeId: pickup.storeId, storeName: pickup.storeName, storeAddress: pickup.storeAddress }, ...stores].slice(0, 5);
  const base = { name: contact.name.trim(), phone: contact.phone.trim(), contactEmail: contact.email.trim().toLowerCase(), savedStores: next, updatedAt: nowIso() };
  if (c) await tx.update(C.shopCustomers, uid, base);
  else tx.set(C.shopCustomers, uid, { ...base, createdAt: nowIso() });
}

// ───────────── 付款回報、顧客取消 ─────────────

export async function reportPayment(tx: Tx, o: Doc, input: { last5: string; amount?: string | null; transferredAt?: string | null; note?: string | null }, actor: Actor) {
  if (!/^\d{5}$/.test(input.last5)) throw new ShopError("ORDER_STATE_CONFLICT", "請輸入匯款帳號末五碼（5 位數字）");
  if (o.paymentStatus === "EXPIRED" || o.fulfillmentStatus === "CANCELLED") throw new ShopError("PAYMENT_EXPIRED", "訂單已取消（付款期限已過）。如果已經匯款，請聯絡客服協助處理");
  if (!["UNPAID", "REJECTED", "PENDING_CONFIRMATION"].includes(o.paymentStatus as string)) throw new ShopError("ORDER_STATE_CONFLICT", "這筆訂單已確認付款或正在處理中");
  for (const r of await tx.query(C.paymentReports, [["orderId", "==", o.id]])) if (r.status === "PENDING") await tx.update(C.paymentReports, r.id, { status: "SUPERSEDED" });
  const now = nowIso();
  tx.create(C.paymentReports, { orderId: o.id, orderNo: o.orderNo, last5: String(input.last5), amount: input.amount ?? null, transferredAt: input.transferredAt ?? null, note: input.note ?? null, status: "PENDING", createdAt: now, lateAfterDeadline: String((o.store as Doc).paymentDeadline) < now });
  await tx.update(C.orders, o.id, { paymentStatus: "PENDING_CONFIRMATION", paymentReference: `末五碼 ${input.last5}`, updatedAt: now });
  statusEvent(tx, o.id, "paymentStatus", o.paymentStatus, "PENDING_CONFIRMATION", actor, `顧客回報末五碼 ${input.last5}`);
  await enqueue(tx, `payment-reported-${o.id}-${sha(now).slice(0, 8)}`, { to: o.customerEmail as string, template: "PAYMENT_REPORTED", orderId: o.id });
  audit(tx, actor, "store.payment.report", "SalesOrder", o.id, `顧客回報匯款末五碼 ${input.last5}`);
}

export async function customerCancel(tx: Tx, o: Doc, actor: Actor) {
  if (o.fulfillmentStatus === "CANCELLED") return;
  if (o.paymentStatus !== "UNPAID") throw new ShopError("ORDER_STATE_CONFLICT", "已回報付款或已付款的訂單，請聯絡客服協助取消");
  if (!["PENDING", "AWAITING_PACKAGING", "READY_TO_SHIP"].includes(o.fulfillmentStatus as string)) throw new ShopError("ORDER_STATE_CONFLICT", "訂單已出貨，無法取消");
  await cancelOrder(tx, o.id, { reason: "顧客自行取消" }, actor);
}

// ───────────── 訂單事件掛勾（付款確認、取消、出貨、退款） ─────────────

/** 釋放預購配額（冪等：依明細 preorderState） */
async function releasePreorders(tx: Tx, orderId: string) {
  for (const it of await tx.query(C.orderItems, [["orderId", "==", orderId]])) {
    if (!it.campaignId || !["RESERVED", "CONFIRMED"].includes(it.preorderState as string)) continue;
    const c = await tx.get(C.preorders, it.campaignId as string);
    if (c) await tx.update(C.preorders, c.id, it.preorderState === "RESERVED" ? { reservedQty: Math.max(0, Number(c.reservedQty ?? 0) - Number(it.quantity)) } : { confirmedQty: Math.max(0, Number(c.confirmedQty ?? 0) - Number(it.quantity)) });
    await tx.update(C.orderItems, it.id, { preorderState: "RELEASED" });
  }
}

async function releasePromotions(tx: Tx, orderId: string) {
  for (const r of await tx.query(C.redemptions, [["orderId", "==", orderId]])) {
    if (r.status !== "ACTIVE") continue;
    const p = await tx.get(C.promotions, r.promoId as string);
    if (p) await tx.update(C.promotions, p.id, { usedCount: Math.max(0, Number(p.usedCount ?? 0) - 1) });
    await tx.update(C.redemptions, r.id, { status: "RELEASED", releasedAt: nowIso() });
  }
}

orderHooks.cancelled.push(async (tx, o) => {
  if (o.channel !== "STORE") return;
  await releasePreorders(tx, o.id);
  await releasePromotions(tx, o.id);
  for (const r of await tx.query(C.paymentReports, [["orderId", "==", o.id]])) if (r.status === "PENDING") await tx.update(C.paymentReports, r.id, { status: "CLOSED" });
  await enqueue(tx, `order-cancelled-${o.id}`, { to: o.customerEmail as string, template: "ORDER_CANCELLED", orderId: o.id });
});

orderHooks.paid.push(async (tx, o) => {
  if (o.channel !== "STORE") return;
  for (const it of await tx.query(C.orderItems, [["orderId", "==", o.id]])) {
    if (!it.campaignId || it.preorderState !== "RESERVED") continue;
    const c = await tx.get(C.preorders, it.campaignId as string);
    if (c) await tx.update(C.preorders, c.id, { reservedQty: Math.max(0, Number(c.reservedQty ?? 0) - Number(it.quantity)), confirmedQty: Number(c.confirmedQty ?? 0) + Number(it.quantity) });
    await tx.update(C.orderItems, it.id, { preorderState: "CONFIRMED" });
  }
  for (const r of await tx.query(C.paymentReports, [["orderId", "==", o.id]])) if (r.status === "PENDING") await tx.update(C.paymentReports, r.id, { status: "ACCEPTED" });
  await patchStore(tx, o.id, { needsReview: false });
  await enqueue(tx, `payment-confirmed-${o.id}`, { to: o.customerEmail as string, template: "PAYMENT_CONFIRMED", orderId: o.id });
});

orderHooks.shipped.push(async (tx, o) => {
  if (o.channel !== "STORE") return;
  await enqueue(tx, `order-shipped-${o.id}`, { to: o.customerEmail as string, template: "ORDER_SHIPPED", orderId: o.id });
});

orderHooks.refunded.push(async (tx, o) => {
  if (o.channel !== "STORE") return;
  await enqueue(tx, `order-refunded-${o.id}-${o.refundedTotal}`, { to: o.customerEmail as string, template: "REFUNDED", orderId: o.id, data: { amount: o.lastRefund } });
});

// ───────────── 後台：付款對帳、預購、物流 ─────────────

export async function rejectPayment(tx: Tx, orderId: string, reason: string, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  if (!["PENDING_CONFIRMATION", "UNDER_REVIEW"].includes(o.paymentStatus as string)) throw new ShopError("ORDER_STATE_CONFLICT", "這筆訂單目前沒有待確認的付款回報");
  for (const r of await tx.query(C.paymentReports, [["orderId", "==", orderId]])) if (r.status === "PENDING") await tx.update(C.paymentReports, r.id, { status: "REJECTED", rejectReason: reason });
  await tx.update(C.orders, orderId, { paymentStatus: "REJECTED", updatedAt: nowIso() });
  statusEvent(tx, orderId, "paymentStatus", o.paymentStatus, "REJECTED", actor, reason);
  await enqueue(tx, `payment-issue-${orderId}-${Date.now()}`, { to: o.customerEmail as string, template: "PAYMENT_ISSUE", orderId, data: { reason } });
  audit(tx, actor, "store.payment.reject", "SalesOrder", orderId, `付款回報有誤：${reason}`);
}

export async function setPaymentStatus(tx: Tx, orderId: string, to: "UNDER_REVIEW" | "REFUND_PENDING", note: string | null, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  const allowed: Record<string, string[]> = { UNDER_REVIEW: ["PENDING_CONFIRMATION", "REJECTED", "EXPIRED", "UNPAID"], REFUND_PENDING: ["PAID", "PARTIALLY_REFUNDED", "EXPIRED", "UNDER_REVIEW"] };
  if (!allowed[to].includes(o.paymentStatus as string)) throw new ShopError("ORDER_STATE_CONFLICT", "目前的付款狀態不能這樣變更");
  await tx.update(C.orders, orderId, { paymentStatus: to, updatedAt: nowIso() });
  statusEvent(tx, orderId, "paymentStatus", o.paymentStatus, to, actor, note);
  audit(tx, actor, "store.payment.status", "SalesOrder", orderId, `付款狀態改為 ${to}${note ? `：${note}` : ""}`);
}

/** 物流狀態（出貨之後）：合法轉換才允許 */
export const SHIP_FLOW: Record<string, string[]> = {
  SHIPPED: ["ARRIVED", "LOGISTICS_ISSUE", "RETURNED_UNCLAIMED"],
  ARRIVED: ["PICKED_UP", "RETURNED_UNCLAIMED", "LOGISTICS_ISSUE"],
  LOGISTICS_ISSUE: ["SHIPPED", "ARRIVED", "RETURNED_UNCLAIMED"],
};
export async function updateShipment(tx: Tx, orderId: string, input: { status: "ARRIVED" | "PICKED_UP" | "LOGISTICS_ISSUE" | "RETURNED_UNCLAIMED" | "SHIPPED"; trackingNo?: string | null; note?: string | null }, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  const from = o.fulfillmentStatus as string;
  if (!(SHIP_FLOW[from] ?? []).includes(input.status)) throw new ShopError("ORDER_STATE_CONFLICT", "目前的物流狀態不能改成這個狀態");
  const ship = { ...((o.shipment as Doc | null) ?? {}), ...(input.trackingNo ? { trackingNo: input.trackingNo } : {}) };
  const patch: Record<string, unknown> = { fulfillmentStatus: input.status, shipment: ship, updatedAt: nowIso() };
  if (input.status === "PICKED_UP") patch.completedAt = nowIso();
  await tx.update(C.orders, orderId, patch);
  statusEvent(tx, orderId, "fulfillmentStatus", from, input.status, actor, input.note ?? null);
  if (o.channel === "STORE" && ["ARRIVED", "LOGISTICS_ISSUE"].includes(input.status)) await enqueue(tx, `ship-${input.status}-${orderId}`, { to: o.customerEmail as string, template: input.status === "ARRIVED" ? "ARRIVED" : "LOGISTICS_ISSUE", orderId });
  audit(tx, actor, "store.shipment", "SalesOrder", orderId, `物流狀態 ${from} → ${input.status}${input.note ? `：${input.note}` : ""}`);
}

/** 預購到貨：把成品（或接單後分裝）分配給預購明細，之後與現貨一起出貨 */
export async function allocatePreorder(tx: Tx, orderId: string, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  if (o.fulfillmentStatus === "CANCELLED") throw new ShopError("ORDER_STATE_CONFLICT", "訂單已取消");
  const s = await storeSettings(tx);
  const items = (await tx.query<OrderItemDoc>(C.orderItems, [["orderId", "==", orderId]])).filter((i) => i.fulfillmentMode === "PREORDER");
  if (!items.length) throw new ShopError("ORDER_STATE_CONFLICT", "這筆訂單沒有待分配的預購商品");
  const shipDate = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  let n = 0;
  for (const it of items) {
    const v = await tx.must(C.variants, it.variantId, "規格");
    const line = { key: it.lineKey as string, name: it.nameSnapshot as string } as PricedLine;
    let mto = false;
    for (const need of requiredUnits(it)) {
      const cv = need.variantId === v.id ? v : await tx.must(C.variants, need.variantId, "組件");
      mto = (await reserveUnits(tx, { order: o, item: it, line, shipDate, s, actor }, cv, need.qty.toNumber())) || mto;
    }
    await tx.update(C.orderItems, it.id, { fulfillmentMode: mto && !v.isBundle ? "MADE_TO_ORDER" : "STOCK", preorderAllocatedAt: nowIso() });
    await refreshItemCostSnapshot(tx, it.id);
    n++;
  }
  await refreshFulfillment(tx, orderId);
  audit(tx, actor, "store.preorder.allocate", "SalesOrder", orderId, `分配預購商品 ${n} 項`);
  return n;
}

/** 預購延期：更新預計出貨日（保留原始承諾日），通知受影響顧客 */
export async function delayPreorder(tx: Tx, campaignId: string, shipDate: string, note: string | null, actor: Actor) {
  const c = await tx.must(C.preorders, campaignId, "預購活動");
  const items = (await tx.query(C.orderItems, [["campaignId", "==", campaignId]])).filter((i) => i.preorderState !== "RELEASED");
  const orderIds = [...new Set(items.map((i) => i.orderId as string))];
  const orders = [];
  for (const id of orderIds) orders.push(await tx.must(C.orders, id, "訂單"));
  await tx.update(C.preorders, c.id, { shipDate, originalShipDate: c.originalShipDate ?? c.shipDate, delayNote: note });
  for (const o of orders) {
    if (o.fulfillmentStatus === "CANCELLED") continue;
    const st = o.store as Doc;
    if (String(st.estShipDate) < shipDate) await patchStore(tx, o.id, { estShipDate: shipDate });
    await enqueue(tx, `preorder-delay-${o.id}-${shipDate}`, { to: o.customerEmail as string, template: "PREORDER_DELAYED", orderId: o.id, data: { shipDate, note } });
  }
  audit(tx, actor, "store.preorder.delay", "PreorderCampaign", c.id, `預購延期：${c.shipDate} → ${shipDate}（影響 ${orders.length} 筆訂單）`);
  return orders.length;
}

// ───────────── 逾期與付款提醒（排程） ─────────────

/** 安全地取消逾期未付款訂單：交易內重新確認仍是「未付款」才取消；已回報付款的只標記待人工確認 */
export async function expireOne(tx: Tx, orderId: string, now: Date, actor: Actor) {
  const o = await tx.get(C.orders, orderId);
  if (!o || o.channel !== "STORE") return "skip";
  const st = o.store as Doc;
  if (String(st.paymentDeadline) > now.toISOString()) return "skip";
  if (o.paymentStatus === "PENDING_CONFIRMATION" || o.paymentStatus === "UNDER_REVIEW") {
    if (!st.needsReview) await patchStore(tx, o.id, { needsReview: true });
    return "review";
  }
  if (o.paymentStatus !== "UNPAID" || o.fulfillmentStatus === "CANCELLED") return "skip";
  await cancelOrder(tx, o.id, { reason: "付款期限已過，系統自動取消" }, actor);
  await tx.update(C.orders, o.id, { paymentStatus: "EXPIRED", updatedAt: nowIso() });
  statusEvent(tx, o.id, "paymentStatus", "UNPAID", "EXPIRED", actor, "付款期限已過");
  return "expired";
}

export async function remindOne(tx: Tx, orderId: string, now: Date, hours: number) {
  const o = await tx.get(C.orders, orderId);
  if (!o || o.paymentStatus !== "UNPAID" || o.fulfillmentStatus === "CANCELLED") return false;
  const st = o.store as Doc;
  const deadline = new Date(String(st.paymentDeadline)).getTime();
  if (st.reminderSentAt || now.getTime() < deadline - hours * 3600_000 || now.getTime() >= deadline) return false;
  await patchStore(tx, o.id, { reminderSentAt: now.toISOString() });
  await enqueue(tx, `payment-reminder-${o.id}`, { to: o.customerEmail as string, template: "PAYMENT_REMINDER", orderId: o.id });
  return true;
}

// ───────────── Email 驗證碼（訪客查詢、歸戶） ─────────────

export async function requestCode(tx: Tx, orderNo: string, email: string) {
  const o = (await tx.query(C.orders, [["orderNo", "==", orderNo.trim().toUpperCase()]]))[0];
  // 不論資料是否正確都回覆相同訊息，避免被用來猜訂單
  if (!o || o.channel !== "STORE" || String(o.customerEmail).toLowerCase() !== email.trim().toLowerCase()) return null;
  const cur = await tx.get(C.orderCodes, o.id);
  const now = Date.now();
  const recent = ((cur?.sends as string[]) ?? []).filter((t) => now - new Date(t).getTime() < 3600_000);
  if (recent.length && now - new Date(recent[recent.length - 1]).getTime() < 60_000) throw new ShopError("RATE_LIMITED", "請稍等一分鐘再重新寄送");
  if (recent.length >= 5) throw new ShopError("RATE_LIMITED", "寄送次數過多，請一小時後再試");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  tx.set(C.orderCodes, o.id, { hash: sha(`${o.id}:${code}`), expiresAt: new Date(now + 10 * 60_000).toISOString(), attempts: 0, sends: [...recent, new Date(now).toISOString()] });
  await enqueue(tx, `code-${o.id}-${now}`, { to: o.customerEmail as string, template: "VERIFY_CODE", orderId: o.id, data: { code } });
  return o.id;
}

export async function verifyCode(tx: Tx, orderNo: string, email: string, code: string) {
  const o = (await tx.query(C.orders, [["orderNo", "==", orderNo.trim().toUpperCase()]]))[0];
  const bad = () => new ShopError("CODE_INVALID", "驗證碼錯誤或已過期");
  if (!o || String(o.customerEmail).toLowerCase() !== email.trim().toLowerCase()) throw bad();
  const cur = await tx.get(C.orderCodes, o.id);
  if (!cur || String(cur.expiresAt) < nowIso()) throw bad();
  if (Number(cur.attempts) >= 5) throw new ShopError("RATE_LIMITED", "錯誤次數過多，請重新寄送驗證碼");
  if (cur.hash !== sha(`${o.id}:${code.trim()}`)) {
    await tx.update(C.orderCodes, o.id, { attempts: Number(cur.attempts) + 1 });
    return { ok: false as const, error: bad() };
  }
  await tx.delete(C.orderCodes, o.id);
  return { ok: true as const, order: o, token: issueAccess(tx, o.id, "VERIFIED", 7) };
}

export async function revokeAccess(tx: Tx, orderId: string, actor: Actor) {
  const list = (await tx.query(C.orderAccess, [["orderId", "==", orderId]])).filter((a) => !a.revokedAt);
  for (const a of list) await tx.update(C.orderAccess, a.id, { revokedAt: nowIso() });
  audit(tx, actor, "store.access.revoke", "SalesOrder", orderId, `撤銷 ${list.length} 個訂單連結`);
  return list.length;
}
