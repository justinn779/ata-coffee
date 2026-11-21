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

const idemDocId = (key: string) => "order-" + createHash("sha256").update(key).digest("hex").slice(0, 40);

export async function createOrder(tx: Tx, input: CreateOrderInput, actor: Actor) {
  if (input.idempotencyKey) {
    const idem = await tx.get(C.uniq, idemDocId(input.idempotencyKey));
    if (idem) return { order: await tx.must(C.orders, idem.orderId as string, "訂單"), duplicate: true };
  }
  if (!input.items.length) throw new DomainError("訂單至少需要一項商品");
  if (!input.customerName?.trim()) throw new DomainError("請填寫顧客名稱");
  const settings = await getSettings(tx);
  const taxMode = settings.tax.mode;
  const taxRate = D(settings.tax.rate);

  const merged = new Map<string, { quantity: number; discount: Decimal }>();
  for (const it of input.items) {
    if (!Number.isInteger(it.quantity) || it.quantity <= 0) throw new DomainError("數量必須為正整數");
    const prev = merged.get(it.variantId);
    merged.set(it.variantId, { quantity: (prev?.quantity ?? 0) + it.quantity, discount: (prev?.discount ?? D(0)).add(it.discount ?? 0) });
  }
  const variants = [];
  for (const vid of merged.keys()) {
    const v = await tx.must(C.variants, vid, "商品 SKU");
    if (v.status === "ARCHIVED" || v.productStatus === "ARCHIVED") throw new DomainError(`${v.sku} 已封存，無法下單`);
    variants.push(v);
  }

  let subtotal = D(0);
  let discountTotal = D(0);
  let taxTotal = D(0);
  const lines = variants.map((v) => {
    const m = merged.get(v.id)!;
    const gross = D(v.salePrice as string).mul(m.quantity);
    if (m.discount.isNegative() || m.discount.gt(gross)) throw new DomainError(`${v.sku} 折扣金額不合理`);
    const lineTotal = money(gross.sub(m.discount));
    const tax = taxMode === "INCLUSIVE" ? money(lineTotal.sub(lineTotal.div(taxRate.add(1)))) : taxMode === "EXCLUSIVE" ? money(lineTotal.mul(taxRate)) : D(0);
    subtotal = subtotal.add(lineTotal);
    discountTotal = discountTotal.add(m.discount);
    taxTotal = taxTotal.add(tax);
    return { v, quantity: m.quantity, discount: m.discount, lineTotal, tax };
  });
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

  for (const l of lines) {
    const mode = l.v.isBundle ? "STOCK" : l.v.stockPolicy === "NOT_TRACKED" ? "NOT_TRACKED" : "STOCK";
    const oi = tx.create(C.orderItems, {
      orderId: order.id,
      orderNo,
      variantId: l.v.id,
      skuSnapshot: l.v.sku,
      nameSnapshot: `${l.v.productName}｜${l.v.name}`,
      quantity: l.quantity,
      unitPriceSnapshot: toDb(l.v.salePrice as string, 2),
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
      const cv = need.variantId === l.v.id ? l.v : await tx.must(C.variants, need.variantId, "組件 SKU");
      const fg = await ensureVariantItem(tx, need.variantId);
      const lots = await availableLots(tx, fg.id);
      const avail = lots.reduce((s, x) => s.add(availableOf(x)), D(0));
      const fromStock = Decimal.min(avail, need.qty);
      if (fromStock.gt(0)) for (const p of planFifo(lots, fromStock, fg.name)) await allocateLotToItem(tx, { orderId: order.id, orderItemId: oi.id, variantId: need.variantId, sku: cv.sku as string, lot: p.lot, qty: p.qty });
      const shortfall = need.qty.sub(fromStock);
      if (shortfall.gt(0)) {
        if (l.v.isBundle || cv.stockPolicy !== "MADE_TO_ORDER") throw new InsufficientStockError(`${cv.sku} 可售庫存 ${avail} 件，不足訂購 ${need.qty} 件（不可超賣）`);
        await planMadeToOrder(tx, { orderId: order.id, orderItemId: oi.id, variant: cv, units: shortfall.toNumber(), actor });
        await tx.update(C.orderItems, oi.id, { fulfillmentMode: "MADE_TO_ORDER" });
      }
    }
    await refreshItemCostSnapshot(tx, oi.id);
  }
  await refreshFulfillment(tx, order.id);
  audit(tx, actor, "order.create", "SalesOrder", order.id, `建立訂單 ${orderNo}，金額 ${total}`);
  return { order: await tx.must(C.orders, order.id, "訂單"), duplicate: false };
}

async function planMadeToOrder(tx: Tx, args: { orderId: string; orderItemId: string; variant: Record<string, unknown> & { id: string }; units: number; actor: Actor }) {
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
  audit(tx, actor, "order.paymentPending", "SalesOrder", orderId, `顧客回報匯款 ${reference ?? ""}`);
  return tx.update(C.orders, orderId, { paymentStatus: "PENDING_CONFIRMATION", paymentReference: reference ?? null, updatedAt: nowIso() });
}

export async function confirmPayment(tx: Tx, orderId: string, input: { method?: string; amount?: Num | null; reference?: string | null; note?: string | null; paidAt?: string }, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  if (o.fulfillmentStatus === "CANCELLED") throw new InvalidStateError("訂單已取消，不可確認付款");
  if (["PAID", "REFUNDED", "PARTIALLY_REFUNDED"].includes(o.paymentStatus as string)) return { order: o, alreadyPaid: true };
  const amount = D(input.amount ?? (o.total as string));
  if (!amount.eq(o.total as string)) throw new DomainError(`付款金額 ${amount} 與訂單金額 ${o.total} 不符`);
  const paidAt = input.paidAt ?? nowIso();
  tx.set(C.payments, `pay-${orderId}`, { orderId, orderNo: o.orderNo, type: "PAYMENT", method: input.method ?? "BANK_TRANSFER", amount: toDb(amount, 2), reference: input.reference ?? null, note: input.note ?? null, occurredAt: paidAt });
  const updated = await tx.update(C.orders, orderId, { paymentStatus: "PAID", paidAt, updatedAt: nowIso() });
  audit(tx, actor, "order.confirmPayment", "SalesOrder", orderId, `確認付款 ${amount}（${input.reference ?? "無參考號"}）`);
  return { order: updated, alreadyPaid: false };
}

export async function shipOrder(tx: Tx, orderId: string, input: { method?: string | null; carrier?: string | null; trackingNo?: string | null; shippingCost?: Num | null; shippedAt?: string; note?: string | null }, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  if (["SHIPPED", "COMPLETED"].includes(o.fulfillmentStatus as string)) throw new InvalidStateError("訂單已出貨，不可重複出貨");
  if (o.fulfillmentStatus !== "READY_TO_SHIP") throw new InvalidStateError("訂單尚未備妥（需為「可出貨」狀態）");
  const settings = await getSettings(tx);
  if (settings.order.requirePaymentBeforeShip && o.paymentStatus !== "PAID") throw new InvalidStateError("訂單尚未確認付款，不可出貨");
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
  audit(tx, actor, "order.ship", "SalesOrder", orderId, `出貨 ${o.orderNo} ${input.carrier ?? ""} ${input.trackingNo ?? ""}`);
  return updated;
}

export async function completeOrder(tx: Tx, orderId: string, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  if (o.fulfillmentStatus !== "SHIPPED") throw new InvalidStateError("僅已出貨的訂單可標記完成");
  await tx.update(C.orders, orderId, { fulfillmentStatus: "COMPLETED", completedAt: nowIso(), updatedAt: nowIso() });
  audit(tx, actor, "order.complete", "SalesOrder", orderId, "訂單完成");
}

export async function recordRefund(tx: Tx, orderId: string, input: { amount: Num; method?: string; reference?: string | null; note?: string | null }, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  if (!["PAID", "PARTIALLY_REFUNDED"].includes(o.paymentStatus as string)) throw new InvalidStateError("僅已付款訂單可退款");
  const amount = money(input.amount);
  if (amount.lte(0)) throw new DomainError("退款金額必須大於 0");
  const refunded = D(o.refundedTotal as string).add(amount);
  if (refunded.gt(o.total as string)) throw new DomainError("退款總額不可超過訂單金額");
  tx.create(C.payments, { orderId, orderNo: o.orderNo, type: "REFUND", method: input.method ?? "BANK_TRANSFER", amount: toDb(amount, 2), reference: input.reference ?? null, note: input.note ?? null, occurredAt: nowIso() });
  await tx.update(C.orders, orderId, { refundedTotal: toDb(refunded, 2), paymentStatus: refunded.eq(o.total as string) ? "REFUNDED" : "PARTIALLY_REFUNDED", updatedAt: nowIso() });
  audit(tx, actor, "order.refund", "SalesOrder", orderId, `退款 ${amount}`);
}

export async function cancelOrder(tx: Tx, orderId: string, input: { reason?: string | null; refundAmount?: Num | null }, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  if (o.fulfillmentStatus === "CANCELLED") return o;
  if (!["PENDING", "AWAITING_PACKAGING", "READY_TO_SHIP"].includes(o.fulfillmentStatus as string)) throw new InvalidStateError("已出貨訂單不可取消，請改辦理退貨");
  const allocs = (await tx.query<AllocationDoc>(C.allocations, [["orderId", "==", orderId]])).filter((a) => a.status === "RESERVED");
  const pos = (await tx.query(C.productionOrders, [["orderId", "==", orderId]])).filter((p) => p.status === "PLANNED");
  for (const a of allocs) {
    await releaseReservation(tx, a.reservationId);
    await tx.update(C.allocations, a.id, { status: "RELEASED" });
  }
  for (const p of pos) await cancelProductionOrder(tx, p.id, actor, { reason: `訂單 ${o.orderNo} 取消`, fromOrder: true });
  await tx.update(C.orders, orderId, { fulfillmentStatus: "CANCELLED", cancelledAt: nowIso(), cancelReason: input.reason ?? null, updatedAt: nowIso() });
  if (input.refundAmount != null && D(input.refundAmount).gt(0)) await recordRefund(tx, orderId, { amount: input.refundAmount, note: "訂單取消退款" }, actor);
  audit(tx, actor, "order.cancel", "SalesOrder", orderId, `取消訂單 ${o.orderNo}${input.reason ? "：" + input.reason : ""}`);
  return tx.must(C.orders, orderId, "訂單");
}

export async function createReturn(tx: Tx, orderId: string, input: { reason?: string | null; items: Array<{ allocationId: string; quantity: Num }> }, actor: Actor) {
  const o = await tx.must(C.orders, orderId, "訂單");
  if (!["SHIPPED", "COMPLETED", "RETURN_PROCESSING"].includes(o.fulfillmentStatus as string)) throw new InvalidStateError("僅已出貨訂單可辦理退貨");
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
    if (returned.add(qty).gt(a.quantity)) throw new DomainError(`退貨數量超過已出貨數量（批次 ${a.lotCode}）`);
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
    if (original.status !== "AVAILABLE") throw new InvalidStateError("原成品批次非可用狀態，無法重新入庫");
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
