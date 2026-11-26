/**
 * 訂單 Domain（Firestore 版）。付款狀態與履約狀態分開。
 *  建立：價格由資料庫讀取；同一交易內依 FIFO 保留成品；可接單後分裝之 SKU 現貨不足時建立分裝單並預留單一熟豆批次。
 *  確認付款：冪等。出貨：消耗保留。取消：釋放保留、取消未完成分裝單。退貨：進入待檢批次。
 */
import { createHash } from "node:crypto";
import { D, money, toDb, type Num, Decimal } from "../../../src/lib/decimal";
import { DomainError, InsufficientStockError, InvalidStateError } from "../../../src/lib/errors";
import { addDaysYmd } from "../../../src/lib/time";
import { newId, nowIso, type Tx } from "../tx";
import { confirmOr, warn } from "../soft";
import { C, type Actor, type InvLot } from "../types";
import { audit, getSettings, nextNumber } from "./core";
import { allocateLotToItem, refreshFulfillment, refreshItemCostSnapshot, requiredUnits, type AllocationDoc, type OrderItemDoc } from "./allocation";
import { availableLots, availableOf, consumeReservation, createLot, ensureCoffeeItem, ensureVariantItem, planFifo, post, releaseReservation } from "./inventory";
import { cancelProductionOrder, createProductionOrder } from "./production";

export interface CreateOrderInput {
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  shippingAddress?: string | null;
  shippingMethod?: string | null;
  shippingFee?: Num | null;
  note?: string | null;
  channel?: "MANUAL" | "WEB" | "OTHER";
  externalRef?: string | null;
  idempotencyKey?: string | null;
  orderedAt?: string;
  items: Array<{ variantId: string; quantity: number; discount?: Num | null }>;
}

/**
 * 訂單事件掛勾：商城在付款確認、取消時需要額外處理（預購配額、優惠使用次數、通知），
 * 由 functions/src/shop 註冊，避免訂單模組反向依賴商城模組。
 */
type OrderHook = (tx: Tx, order: Record<string, unknown> & { id: string }, actor: Actor) => Promise<void>;
export const orderHooks: { paid: OrderHook[]; cancelled: OrderHook[]; shipped: OrderHook[]; refunded: OrderHook[] } = { paid: [], cancelled: [], shipped: [], refunded: [] };

/** 狀態歷史：每次訂單、付款、履約狀態變動都留一筆（後台與顧客訂單進度使用） */
export function statusEvent(tx: Tx, orderId: string, field: "orderStatus" | "paymentStatus" | "fulfillmentStatus", from: unknown, to: unknown, actor: Actor, note?: string | null) {
  if (from === to) return;
  tx.create(C.orderEvents, { orderId, field, from: from ?? null, to, actorId: actor.userId, actorName: actor.name ?? null, note: note ?? null, at: nowIso() });
}

const idemDocId = (key: string) => "order-" + createHash("sha256").update(key).digest("hex").slice(0, 40);

export async function createOrder(tx: Tx, input: CreateOrderInput, actor: Actor) {
  if (input.idempotencyKey) {
    const idem = await tx.get(C.uniq, idemDocId(input.idempotencyKey));
    if (idem) return { order: await tx.must(C.orders, idem.orderId as string, "訂單"), duplicate: true };
  }
  if (!input.items.length) throw new DomainError("訂單至少需要一項商品");
  if (!input.customerName?.trim()) throw new DomainError("請填寫顧客名稱");
  const { lines, subtotal, discountTotal, taxTotal, taxMode, taxRate } = await priceLines(tx, input.items);
  const shippingFee = money(input.shippingFee ?? 0);
  if (shippingFee.isNegative()) throw new DomainError("運費不可為負");
  const total = subtotal.add(taxMode === "EXCLUSIVE" ? taxTotal : 0).add(shippingFee);
  if (input.externalRef) await tx.claimUnique("externalRef", input.externalRef, `外部訂單編號 ${input.externalRef} 已存在`);

  const orderNo = await nextNumber(tx, "SO");
  const now = nowIso();
  const order = tx.create(C.orders, {
    orderNo,
    channel: input.channel ?? "MANUAL",
    externalRef: input.externalRef ?? null,
    customerId: input.customerId ?? null,
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone ?? null,
    customerEmail: input.customerEmail ?? null,
    shippingAddress: input.shippingAddress ?? null,
    shippingMethod: input.shippingMethod ?? null,
    orderedAt: input.orderedAt ?? now,
    paymentStatus: "UNPAID",
    fulfillmentStatus: "PENDING",
    taxMode,
    taxRate: toDb(taxRate, 4),
    subtotal: toDb(subtotal, 2),
    discountTotal: toDb(discountTotal, 2),
    taxTotal: toDb(taxTotal, 2),
    shippingFee: toDb(shippingFee, 2),
    total: toDb(total, 2),
    refundedTotal: "0.00",
    note: input.note ?? null,
    paidAt: null,
    cancelledAt: null,
    completedAt: null,
    shipment: null,
    createdAt: now,
    updatedAt: now,
  });
  if (input.idempotencyKey) tx.set(C.uniq, idemDocId(input.idempotencyKey), { kind: "orderIdempotency", orderId: order.id, at: now });

  await createItems(tx, { id: order.id, orderNo, orderedAt: order.orderedAt }, lines, actor);
  await refreshFulfillment(tx, order.id);
  audit(tx, actor, "order.create", "SalesOrder", order.id, `建立訂單 ${orderNo}，金額 ${total}`);
  return { order: await tx.must(C.orders, order.id, "訂單"), duplicate: false };
}


type PricedLine = { v: Record<string, unknown> & { id: string }; quantity: number; discount: Decimal; unitPrice: Decimal; lineTotal: Decimal; tax: Decimal };

/**
 * 計價：價格一律由資料庫讀取。keepPrices 提供時（修改訂單），原訂單已有的 SKU 沿用下單時的單價。
 */
async function priceLines(tx: Tx, items: CreateOrderInput["items"], keepPrices?: Map<string, string>) {
  if (!items.length) throw new DomainError("訂單至少需要一項商品");
  const settings = await getSettings(tx);
  const taxMode = settings.tax.mode;
  const taxRate = D(settings.tax.rate);
  const merged = new Map<string, { quantity: number; discount: Decimal }>();
  for (const it of items) {
    if (!Number.isInteger(it.quantity) || it.quantity <= 0) throw new DomainError("數量必須為正整數");
    const prev = merged.get(it.variantId);
    merged.set(it.variantId, { quantity: (prev?.quantity ?? 0) + it.quantity, discount: (prev?.discount ?? D(0)).add(it.discount ?? 0) });
  }
  let subtotal = D(0);
  let discountTotal = D(0);
  let taxTotal = D(0);
  const lines: PricedLine[] = [];
  for (const [vid, m] of merged) {
    const v = await tx.must(C.variants, vid, "商品品項");
    const kept = keepPrices?.get(vid);
    if (!kept && (v.status === "ARCHIVED" || v.productStatus === "ARCHIVED")) confirmOr(`${v.sku} 已封存，仍要下單嗎？`);
    const unitPrice = D(kept ?? (v.salePrice as string));
    const gross = unitPrice.mul(m.quantity);
    if (m.discount.isNegative() || m.discount.gt(gross)) throw new DomainError(`${v.sku} 折扣金額不合理`);
    const lineTotal = money(gross.sub(m.discount));
    const tax = taxMode === "INCLUSIVE" ? money(lineTotal.sub(lineTotal.div(taxRate.add(1)))) : taxMode === "EXCLUSIVE" ? money(lineTotal.mul(taxRate)) : D(0);
    subtotal = subtotal.add(lineTotal);
    discountTotal = discountTotal.add(m.discount);
    taxTotal = taxTotal.add(tax);
    lines.push({ v, quantity: m.quantity, discount: m.discount, unitPrice, lineTotal, tax });
  }
  return { lines, subtotal, discountTotal, taxTotal, taxMode, taxRate };
}

/** 建立訂單明細，並以 FIFO 保留成品；可接單後分裝的 SKU 現貨不足時建立分裝單（不可超賣） */
async function createItems(tx: Tx, order: { id: string; orderNo: string; orderedAt: unknown }, lines: PricedLine[], actor: Actor) {
  for (const l of lines) {
    const mode = l.v.isBundle ? "STOCK" : l.v.stockPolicy === "NOT_TRACKED" ? "NOT_TRACKED" : "STOCK";
    const oi = tx.create(C.orderItems, {
      orderId: order.id,
      orderNo: order.orderNo,
      variantId: l.v.id,
      skuSnapshot: l.v.sku,
      nameSnapshot: `${l.v.productName}｜${l.v.name}`,
      quantity: l.quantity,
      unitPriceSnapshot: toDb(l.unitPrice, 2),
      discount: toDb(l.discount, 2),
      taxAmount: toDb(l.tax, 2),
      lineTotal: toDb(l.lineTotal, 2),
      costSnapshot: null,
      isBundle: !!l.v.isBundle,
      bundleComponents: ((l.v.bundleComponents as Array<{ variantId: string; quantity: number }>) ?? []).map((c) => ({ variantId: c.variantId, quantity: c.quantity })),
      fulfillmentMode: mode,
      orderedAt: order.orderedAt,
    }) as unknown as OrderItemDoc;
    if (mode === "NOT_TRACKED") continue;
    for (const need of requiredUnits(oi)) {
      const cv = need.variantId === l.v.id ? l.v : await tx.must(C.variants, need.variantId, "組件品項");
      const fg = await ensureVariantItem(tx, need.variantId);
      const lots = await availableLots(tx, fg.id);
      const avail = lots.reduce((s, x) => s.add(availableOf(x)), D(0));
      const fromStock = Decimal.min(avail, need.qty);
      if (fromStock.gt(0)) for (const p of planFifo(lots, fromStock, fg.name)) await allocateLotToItem(tx, { orderId: order.id, orderItemId: oi.id, variantId: need.variantId, sku: cv.sku as string, lot: p.lot, qty: p.qty });
      const shortfall = need.qty.sub(fromStock);
      if (shortfall.gt(0)) {
        if (l.v.isBundle || cv.stockPolicy !== "MADE_TO_ORDER" || !(await canMadeToOrder(tx, cv, shortfall.toNumber()))) {
          confirmOr(`${cv.sku} 可售庫存 ${avail} 件，不足訂購 ${need.qty} 件。仍要建立嗎？缺的 ${shortfall} 件會先記著，補貨後在訂單按「修改」重新保留庫存`);
          continue;
        }
        await planMadeToOrder(tx, { orderId: order.id, orderItemId: oi.id, variant: cv, units: shortfall.toNumber(), actor });
        await tx.update(C.orderItems, oi.id, { fulfillmentMode: "MADE_TO_ORDER" });
      }
    }
    await refreshItemCostSnapshot(tx, oi.id);
  }
}

export type UpdateOrderInput = Omit<CreateOrderInput, "channel" | "externalRef" | "idempotencyKey" | "orderedAt">;

/**
 * 出貨前修改訂單（品項、數量、折扣、運費、收件資訊）。
 * 限制：尚未出貨、且尚未確認付款（未付款或待確認）。已付款請先取消並退款後重新建單。
 * 作法（同一交易內）：釋放原保留量、取消未完成的接單後分裝單、刪除原明細 → 依新內容重新計價並保留庫存。
 * 原訂單已有的 SKU 沿用下單時單價；新加入的 SKU 使用目前售價。任何品項庫存不足時整筆修改失敗、原訂單不變。
 */
export async function updateOrder(tx: Tx, orderId: string, input: UpdateOrderInput, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  if (!input.customerName?.trim()) throw new DomainError("請填寫顧客名稱");
  const oldItems = await tx.query<OrderItemDoc>(C.orderItems, [["orderId", "==", orderId]]);
  const allocs = await tx.query<AllocationDoc>(C.allocations, [["orderId", "==", orderId]]);
  const shipped = !["PENDING", "AWAITING_PACKAGING", "READY_TO_SHIP", "CANCELLED"].includes(o.fulfillmentStatus as string) || allocs.some((a) => a.status === "SHIPPED");
  if (shipped) return updateShippedOrderInfo(tx, o, oldItems, input, actor);
  if (o.fulfillmentStatus === "CANCELLED") confirmOr("這筆訂單已取消，修改後會重新保留庫存並回到待出貨。仍要修改嗎？");
  if (!["UNPAID", "PENDING_CONFIRMATION"].includes(o.paymentStatus as string)) confirmOr("訂單已確認付款，修改內容後金額可能跟已收款不同，需要自行補收或退款。仍要修改嗎？");
  const pos = (await tx.query(C.productionOrders, [["orderId", "==", orderId]])).filter((p) => p.status === "PLANNED");

  // 1) 釋放原保留、取消未完成的接單後分裝單、刪除原明細
  for (const a of allocs) {
    if (a.status === "RESERVED") await releaseReservation(tx, a.reservationId);
    await tx.delete(C.allocations, a.id);
  }
  for (const p of pos) await cancelProductionOrder(tx, p.id, actor, { reason: `訂單 ${o.orderNo} 修改`, fromOrder: true });
  for (const it of oldItems) await tx.delete(C.orderItems, it.id);

  // 2) 重新計價、建立明細並保留庫存
  const keep = new Map(oldItems.map((it) => [it.variantId, it.unitPriceSnapshot as string]));
  const { lines, subtotal, discountTotal, taxTotal, taxMode, taxRate } = await priceLines(tx, input.items, keep);
  const shippingFee = money(input.shippingFee ?? 0);
  if (shippingFee.isNegative()) throw new DomainError("運費不可為負");
  const total = subtotal.add(taxMode === "EXCLUSIVE" ? taxTotal : 0).add(shippingFee);
  await tx.update(C.orders, orderId, {
    customerId: input.customerId ?? null,
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone ?? null,
    customerEmail: input.customerEmail ?? null,
    shippingAddress: input.shippingAddress ?? null,
    shippingMethod: input.shippingMethod ?? null,
    note: input.note ?? null,
    taxMode,
    taxRate: toDb(taxRate, 4),
    subtotal: toDb(subtotal, 2),
    discountTotal: toDb(discountTotal, 2),
    taxTotal: toDb(taxTotal, 2),
    shippingFee: toDb(shippingFee, 2),
    total: toDb(total, 2),
    fulfillmentStatus: "PENDING",
    cancelledAt: null,
    updatedAt: nowIso(),
  });
  if (["PAID", "PARTIALLY_REFUNDED"].includes(o.paymentStatus as string) && !D(o.total as string).eq(total)) warn(`訂單金額 ${o.total} → ${toDb(total, 2)}，跟已收款不同，請自行補收或退款`);
  await createItems(tx, { id: orderId, orderNo: o.orderNo as string, orderedAt: o.orderedAt }, lines, actor);
  await refreshFulfillment(tx, orderId);
  const before = oldItems.map((it) => `${it.skuSnapshot}×${it.quantity}`).join("、");
  const after = lines.map((l) => `${l.v.sku}×${l.quantity}`).join("、");
  audit(tx, actor, "order.update", "SalesOrder", orderId, `修改訂單 ${o.orderNo}：${before} → ${after}；金額 ${o.total} → ${toDb(total, 2)}`);
  return tx.must(C.orders, orderId, "訂單");
}

/** 是否能接單後分裝（有設定咖啡豆與填充重量，且有單一熟豆批次足量） */
async function canMadeToOrder(tx: Tx, v: Record<string, unknown>, units: number) {
  if (!v.coffeeId || !v.fillWeightG) return false;
  const roasted = await ensureCoffeeItem(tx, v.coffeeId as string, "ROASTED").catch(() => null);
  if (!roasted) return false;
  const need = D(v.fillWeightG as string).mul(units);
  return (await availableLots(tx, roasted.id)).some((l) => availableOf(l).gte(need));
}

/** 已出貨訂單的修改：先提醒；品項與庫存不動，只更新顧客、收件、運費、備註 */
async function updateShippedOrderInfo(tx: Tx, o: Record<string, unknown> & { id: string }, oldItems: OrderItemDoc[], input: UpdateOrderInput, actor: Actor) {
  const before = new Map(oldItems.map((it) => [it.variantId, it.quantity]));
  const sameItems = input.items.length === before.size && input.items.every((it) => before.get(it.variantId) === it.quantity);
  confirmOr(sameItems ? "這筆訂單已出貨，修改顧客、收件、運費等資料不會影響庫存。仍要修改嗎？" : "這筆訂單已出貨，品項與數量不會變更（請改用退貨），只會更新顧客、收件、運費與備註。仍要修改嗎？");
  const shippingFee = money(input.shippingFee ?? 0);
  const total = D(o.total as string).sub(o.shippingFee as string).add(shippingFee);
  await tx.update(C.orders, o.id, {
    customerId: input.customerId ?? null,
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone ?? null,
    customerEmail: input.customerEmail ?? null,
    shippingAddress: input.shippingAddress ?? null,
    shippingMethod: input.shippingMethod ?? null,
    note: input.note ?? null,
    shippingFee: toDb(shippingFee, 2),
    total: toDb(total, 2),
    updatedAt: nowIso(),
  });
  audit(tx, actor, "order.update", "SalesOrder", o.id, `修改已出貨訂單 ${o.orderNo} 的顧客／收件資料`);
  return tx.must(C.orders, o.id, "訂單");
}

export async function planMadeToOrder(tx: Tx, args: { orderId: string; orderItemId: string; variant: Record<string, unknown> & { id: string }; units: number; actor: Actor }) {
  const v = args.variant;
  if (!v.coffeeId || !v.fillWeightG) throw new DomainError(`${v.sku} 未設定對應咖啡豆或填充重量，無法接單後分裝`);
  const roasted = await ensureCoffeeItem(tx, v.coffeeId as string, "ROASTED");
  const need = D(v.fillWeightG as string).mul(args.units);
  const src = (await availableLots(tx, roasted.id)).find((l) => availableOf(l).gte(need));
  if (!src) throw new InsufficientStockError(`${v.sku} 無現貨，且沒有單一熟豆批次可用量 ≥ ${need}g，無法接單後分裝`);
  return createProductionOrder(tx, { sourceLotId: src.id, targetVariantId: v.id, plannedQty: args.units, plannedDate: addDaysYmd(new Date(), 0), mode: "MADE_TO_ORDER", orderItemId: args.orderItemId, orderId: args.orderId, note: "接單後分裝（系統依訂單建立）" }, args.actor);
}

export async function markPaymentPending(tx: Tx, orderId: string, actor: Actor, reference?: string | null) {
  const o = await tx.must(C.orders, orderId, "訂單");
  if (o.paymentStatus !== "UNPAID") return o;
  statusEvent(tx, orderId, "paymentStatus", o.paymentStatus, "PENDING_CONFIRMATION", actor, reference ?? null);
  audit(tx, actor, "order.paymentPending", "SalesOrder", orderId, `顧客回報匯款 ${reference ?? ""}`);
  return tx.update(C.orders, orderId, { paymentStatus: "PENDING_CONFIRMATION", paymentReference: reference ?? null, updatedAt: nowIso() });
}

export async function confirmPayment(tx: Tx, orderId: string, input: { method?: string; amount?: Num | null; reference?: string | null; note?: string | null; paidAt?: string }, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  if (o.fulfillmentStatus === "CANCELLED") confirmOr("這筆訂單已取消，仍要確認付款嗎？");
  if (["PAID", "REFUNDED", "PARTIALLY_REFUNDED"].includes(o.paymentStatus as string)) return { order: o, alreadyPaid: true };
  const amount = D(input.amount ?? (o.total as string));
  if (!amount.eq(o.total as string)) confirmOr(`付款金額 ${amount} 與訂單金額 ${o.total} 不同，仍要記為已付款嗎？`);
  const paidAt = input.paidAt ?? nowIso();
  tx.set(C.payments, `pay-${orderId}`, { orderId, orderNo: o.orderNo, type: "PAYMENT", method: input.method ?? "BANK_TRANSFER", amount: toDb(amount, 2), reference: input.reference ?? null, note: input.note ?? null, occurredAt: paidAt });
  const updated = await tx.update(C.orders, orderId, { paymentStatus: "PAID", paidAt, updatedAt: nowIso() });
  statusEvent(tx, orderId, "paymentStatus", o.paymentStatus, "PAID", actor, input.reference ?? null);
  for (const h of orderHooks.paid) await h(tx, updated, actor);
  audit(tx, actor, "order.confirmPayment", "SalesOrder", orderId, `確認付款 ${amount}（${input.reference ?? "無參考號"}）`);
  return { order: updated, alreadyPaid: false };
}

export async function shipOrder(tx: Tx, orderId: string, input: { method?: string | null; carrier?: string | null; trackingNo?: string | null; shippingCost?: Num | null; shippedAt?: string; note?: string | null }, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  if (["SHIPPED", "COMPLETED"].includes(o.fulfillmentStatus as string)) throw new InvalidStateError("訂單已出貨，不可重複出貨");
  if (o.fulfillmentStatus === "CANCELLED") confirmOr("這筆訂單已取消，仍要出貨嗎？");
  else if (o.fulfillmentStatus !== "READY_TO_SHIP") confirmOr("訂單還有商品沒備妥（沒有保留到庫存），出貨時只會扣已保留的部分。仍要出貨嗎？");
  const settings = await getSettings(tx);
  if (settings.order.requirePaymentBeforeShip && o.paymentStatus !== "PAID") confirmOr("訂單尚未確認付款，仍要出貨嗎？");
  const shippedAt = input.shippedAt ?? nowIso();
  const allocs = (await tx.query<AllocationDoc>(C.allocations, [["orderId", "==", orderId]])).filter((a) => a.status === "RESERVED");
  const groupId = newId();
  for (const a of allocs) {
    await consumeReservation(tx, a.reservationId, "SHIPMENT_ISSUE", { actor, refType: "SalesOrder", refId: o.id, groupId, note: `出貨 ${o.orderNo}` });
    await tx.update(C.allocations, a.id, { status: "SHIPPED", shippedAt });
  }
  if (input.shippingCost != null && D(input.shippingCost).gt(0)) {
    tx.create(C.costs, { category: "SHIPPING", target: "SALES_ORDER", amount: toDb(input.shippingCost, 2), isEstimate: false, occurredOn: addDaysYmd(new Date(shippedAt), 0), roastBatchId: null, productionOrderId: null, orderId: o.id, calcNote: "出貨時輸入之實際物流成本", note: null, createdAt: nowIso() });
  }
  const updated = await tx.update(C.orders, orderId, {
    fulfillmentStatus: "SHIPPED",
    shipment: { method: input.method ?? o.shippingMethod ?? null, carrier: input.carrier ?? null, trackingNo: input.trackingNo ?? null, shippingCost: toDb(input.shippingCost ?? 0, 2), shippedAt, note: input.note ?? null },
    shippedAt,
    updatedAt: nowIso(),
  });
  statusEvent(tx, orderId, "fulfillmentStatus", o.fulfillmentStatus, "SHIPPED", actor, [input.carrier, input.trackingNo].filter(Boolean).join(" ") || null);
  for (const h of orderHooks.shipped) await h(tx, updated, actor);
  audit(tx, actor, "order.ship", "SalesOrder", orderId, `出貨 ${o.orderNo} ${input.carrier ?? ""} ${input.trackingNo ?? ""}`);
  return updated;
}

export async function completeOrder(tx: Tx, orderId: string, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  if (o.fulfillmentStatus !== "SHIPPED") confirmOr("這筆訂單還沒出貨，仍要標記完成嗎？（不會扣庫存）");
  await tx.update(C.orders, orderId, { fulfillmentStatus: "COMPLETED", completedAt: nowIso(), updatedAt: nowIso() });
  statusEvent(tx, orderId, "fulfillmentStatus", o.fulfillmentStatus, "COMPLETED", actor);
  audit(tx, actor, "order.complete", "SalesOrder", orderId, "訂單完成");
}

export async function recordRefund(tx: Tx, orderId: string, input: { amount: Num; method?: string; reference?: string | null; note?: string | null }, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  if (!["PAID", "PARTIALLY_REFUNDED", "REFUND_PENDING"].includes(o.paymentStatus as string)) confirmOr("這筆訂單還沒確認付款，仍要記錄退款嗎？");
  const amount = money(input.amount);
  if (amount.lte(0)) throw new DomainError("退款金額必須大於 0");
  const refunded = D(o.refundedTotal as string).add(amount);
  if (refunded.gt(o.total as string)) confirmOr(`退款總額 ${refunded} 會超過訂單金額 ${o.total}，仍要記錄嗎？`);
  tx.create(C.payments, { orderId, orderNo: o.orderNo, type: "REFUND", method: input.method ?? "BANK_TRANSFER", amount: toDb(amount, 2), reference: input.reference ?? null, note: input.note ?? null, occurredAt: nowIso() });
  const nextPay = refunded.gte(o.total as string) ? "REFUNDED" : "PARTIALLY_REFUNDED";
  const after = await tx.update(C.orders, orderId, { refundedTotal: toDb(refunded, 2), paymentStatus: nextPay, updatedAt: nowIso() });
  statusEvent(tx, orderId, "paymentStatus", o.paymentStatus, nextPay, actor, `退款 ${amount}`);
  for (const h of orderHooks.refunded) await h(tx, { ...after, lastRefund: toDb(amount, 2) }, actor);
  audit(tx, actor, "order.refund", "SalesOrder", orderId, `退款 ${amount}`);
}

export async function cancelOrder(tx: Tx, orderId: string, input: { reason?: string | null; refundAmount?: Num | null }, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  if (o.fulfillmentStatus === "CANCELLED") return o;
  if (!["PENDING", "AWAITING_PACKAGING", "READY_TO_SHIP"].includes(o.fulfillmentStatus as string)) confirmOr("這筆訂單已出貨，取消不會把商品退回庫存（要退回庫存請用「退貨」）。仍要取消嗎？");
  const allocs = (await tx.query<AllocationDoc>(C.allocations, [["orderId", "==", orderId]])).filter((a) => a.status === "RESERVED");
  const pos = (await tx.query(C.productionOrders, [["orderId", "==", orderId]])).filter((p) => p.status === "PLANNED");
  for (const a of allocs) {
    await releaseReservation(tx, a.reservationId);
    await tx.update(C.allocations, a.id, { status: "RELEASED" });
  }
  for (const p of pos) await cancelProductionOrder(tx, p.id, actor, { reason: `訂單 ${o.orderNo} 取消`, fromOrder: true });
  const cancelled = await tx.update(C.orders, orderId, { fulfillmentStatus: "CANCELLED", cancelledAt: nowIso(), cancelReason: input.reason ?? null, updatedAt: nowIso() });
  statusEvent(tx, orderId, "fulfillmentStatus", o.fulfillmentStatus, "CANCELLED", actor, input.reason ?? null);
  for (const h of orderHooks.cancelled) await h(tx, cancelled, actor);
  if (input.refundAmount != null && D(input.refundAmount).gt(0)) await recordRefund(tx, orderId, { amount: input.refundAmount, note: "訂單取消退款" }, actor);
  audit(tx, actor, "order.cancel", "SalesOrder", orderId, `取消訂單 ${o.orderNo}${input.reason ? "：" + input.reason : ""}`);
  return tx.must(C.orders, orderId, "訂單");
}

export async function createReturn(tx: Tx, orderId: string, input: { reason?: string | null; items: Array<{ allocationId: string; quantity: Num }> }, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  if (!["SHIPPED", "COMPLETED", "RETURN_PROCESSING"].includes(o.fulfillmentStatus as string)) confirmOr("這筆訂單目前不是已出貨狀態，仍要辦理退貨嗎？");
  if (!input.items.length) throw new DomainError("請選擇退貨品項");
  const returnNo = await nextNumber(tx, "RT");
  const groupId = newId();
  const items = [];
  const rrId = newId();
  for (const ri of input.items) {
    const qty = D(ri.quantity);
    if (qty.lte(0)) throw new DomainError("退貨數量必須大於 0");
    const a = await tx.get<AllocationDoc>(C.allocations, ri.allocationId);
    if (!a || a.orderId !== orderId || a.status !== "SHIPPED") throw new DomainError("退貨品項不屬於此訂單或尚未出貨");
    const returned = D((a.returnedQty as string) ?? 0);
    if (returned.add(qty).gt(a.quantity)) confirmOr(`退貨數量超過已出貨數量（批次 ${a.lotCode}），仍要記錄嗎？`);
    const orig = await tx.must<InvLot>(C.lots, a.lotId, "原批次");
    const qLot = await createLot(tx, { itemId: orig.itemId, lotCode: `${returnNo}-${orig.lotCode}`, unitCost: a.unitCost, status: "QUARANTINE", returnSourceLotId: a.lotId, producedAt: orig.producedAt ?? undefined, expiryDate: orig.expiryDate, expirySource: orig.expirySource, note: `退貨待檢（${o.orderNo}）` });
    await post(tx, { lotId: qLot.id, type: "RETURN_QUARANTINE", quantity: qty, refType: "ReturnRecord", refId: rrId, groupId, actor, note: `退貨 ${returnNo}` });
    await tx.update(C.allocations, a.id, { returnedQty: toDb(returned.add(qty), 3) });
    items.push({ id: newId(), allocationId: a.id, sku: a.sku, lotCode: a.lotCode, originalLotId: a.lotId, unitCost: a.unitCost, quantity: toDb(qty, 3), quarantineLotId: qLot.id, disposition: null, inspectedAt: null, note: null });
  }
  const rr = tx.create(C.returns, { returnNo, orderId, orderNo: o.orderNo, status: "PENDING_INSPECTION", reason: input.reason ?? null, items, createdAt: nowIso(), completedAt: null }, rrId);
  await tx.update(C.orders, orderId, { fulfillmentStatus: "RETURN_PROCESSING", updatedAt: nowIso() });
  audit(tx, actor, "order.return", "ReturnRecord", rr.id, `建立退貨 ${returnNo}（訂單 ${o.orderNo}）`);
  return rr;
}

export async function inspectReturnItem(tx: Tx, returnId: string, itemId: string, disposition: "RESTOCK" | "SCRAP", actor: Actor, note?: string | null) {
  const rr = await tx.must(C.returns, returnId, "退貨單");
  const items = rr.items as Array<Record<string, unknown> & { id: string }>;
  const ri = items.find((x) => x.id === itemId);
  if (!ri) throw new DomainError("找不到退貨明細");
  if (ri.disposition) throw new InvalidStateError("此退貨明細已檢查完成");
  const original = await tx.must<InvLot>(C.lots, ri.originalLotId as string, "原批次");
  await tx.must<InvLot>(C.lots, ri.quarantineLotId as string, "待檢批次");
  const groupId = newId();
  const ctx = { refType: "ReturnRecord", refId: rr.id, groupId, actor };
  if (disposition === "RESTOCK") {
    if (original.status !== "AVAILABLE") confirmOr(`原成品批次 ${original.lotCode} 目前不是可用狀態，仍要重新入庫到這批嗎？`);
    await post(tx, { ...ctx, lotId: ri.quarantineLotId as string, type: "RETURN_RESTOCK_OUT", quantity: D(ri.quantity as string).neg(), note: note ?? "檢查合格，重新入庫" });
    await post(tx, { ...ctx, lotId: original.id, type: "RETURN_RESTOCK_IN", quantity: ri.quantity as string, note: note ?? `退貨 ${rr.returnNo} 重新入庫` });
  } else {
    await post(tx, { ...ctx, lotId: ri.quarantineLotId as string, type: "SCRAP", quantity: D(ri.quantity as string).neg(), note: note ?? "退貨檢查不合格，報廢" });
  }
  const inspectedAt = nowIso();
  const nextItems = items.map((x) => (x.id === itemId ? { ...x, disposition, inspectedAt, note: note ?? null } : x));
  const done = nextItems.every((x) => x.disposition);
  await tx.update(C.returns, rr.id, { items: nextItems, status: done ? "COMPLETED" : "PENDING_INSPECTION", completedAt: done ? inspectedAt : null });
  if (done) {
    const open = (await tx.query(C.returns, [["orderId", "==", rr.orderId]])).filter((r) => r.status === "PENDING_INSPECTION");
    if (!open.length) await tx.update(C.orders, rr.orderId as string, { fulfillmentStatus: "COMPLETED", completedAt: inspectedAt, updatedAt: inspectedAt });
  }
  audit(tx, actor, "return.inspect", "ReturnItem", itemId, `退貨檢查：${disposition === "RESTOCK" ? "重新入庫" : "報廢"} ${ri.quantity}`);
}

export async function addOrderCost(tx: Tx, orderId: string, input: { category: string; amount: Num; isEstimate?: boolean; calcNote?: string | null }, actor: Actor) {
  if (!["SHIPPING", "PLATFORM_FEE", "PAYMENT_FEE", "ORDER_OTHER"].includes(input.category)) throw new DomainError("此成本類別不屬於訂單直接成本");
  await tx.must(C.orders, orderId, "訂單");
  tx.create(C.costs, { category: input.category, target: "SALES_ORDER", amount: toDb(input.amount, 2), isEstimate: input.isEstimate ?? false, occurredOn: addDaysYmd(new Date(), 0), roastBatchId: null, productionOrderId: null, orderId, calcNote: input.calcNote ?? null, note: null, createdAt: nowIso() });
  audit(tx, actor, "order.cost", "SalesOrder", orderId, `新增訂單成本 ${input.category} ${input.amount}`);
}

/**
 * 刪除訂單：只限尚未出貨、沒有退貨的訂單。會先取消（釋放保留的成品、取消接單後分裝），
 * 再刪除訂單、明細、分配、付款與訂單成本。已收款且未退款的訂單需先取消並退款。
 */
export async function deleteOrder(tx: Tx, orderId: string, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  const allocs = await tx.query<AllocationDoc>(C.allocations, [["orderId", "==", orderId]]);
  const returns = await tx.query(C.returns, [["orderId", "==", orderId]]);
  const pos = await tx.query(C.productionOrders, [["orderId", "==", orderId]]);
  const doneMo = pos.filter((p) => p.status === "COMPLETED");
  const notes = [
    allocs.some((a) => a.status === "SHIPPED") ? "已出貨（出貨扣掉的庫存不會退回）" : "",
    returns.length ? `有 ${returns.length} 筆退貨紀錄（會保留）` : "",
    o.paymentStatus === "PAID" ? "已收款（付款紀錄會一起刪除，請自行處理退款）" : "",
    doneMo.length ? `接單後分裝單 ${doneMo.map((p) => p.orderNo).join("、")} 已完成（成品留在庫存）` : "",
  ].filter(Boolean);
  if (notes.length) confirmOr(`這筆訂單${notes.join("、")}。確定刪除嗎？`);
  if (["PENDING", "AWAITING_PACKAGING", "READY_TO_SHIP"].includes(o.fulfillmentStatus as string)) await cancelOrder(tx, orderId, { reason: "刪除訂單" }, actor);
  else for (const a of allocs.filter((x) => x.status === "RESERVED")) await releaseReservation(tx, a.reservationId);
  for (const p of pos) {
    if (p.status === "PLANNED") await cancelProductionOrder(tx, p.id, actor, { reason: "訂單刪除", fromOrder: true });
    if (p.status === "COMPLETED") await tx.update(C.productionOrders, p.id, { orderId: null, orderItemId: null, mode: "PRE_PACK", note: [p.note, `原訂單 ${o.orderNo} 已刪除`].filter(Boolean).join("；") });
    else await tx.delete(C.productionOrders, p.id);
  }
  for (const col of [C.orderItems, C.allocations, C.payments, C.costs]) for (const d of await tx.query(col, [["orderId", "==", orderId]])) await tx.delete(col, d.id);
  if (o.externalRef) await tx.releaseUnique("externalRef", o.externalRef as string);
  await tx.delete(C.orders, orderId);
  audit(tx, actor, "order.delete", "SalesOrder", orderId, `刪除訂單 ${o.orderNo}（${o.customerName}）`);
}
