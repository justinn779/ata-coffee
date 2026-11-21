/**
 * 訂單 Domain。付款狀態與履約狀態為兩個獨立欄位。
 *
 *  建立訂單：價格一律由資料庫讀取（不信任前端），於單一交易中依 FIFO 保留成品；
 *            可接單後分裝之 SKU 若現貨不足，建立接單後分裝生產單並預留單一熟豆批次。
 *  確認付款：冪等，不異動庫存。
 *  出貨：消耗已保留之成品（出貨扣帳），寫入物流成本。
 *  取消：釋放保留、取消未完成之接單後分裝生產單；帳本歷史保留。
 *  退貨：退回待檢批次（不可售），檢查後才可重新入庫或報廢。
 */
import { randomUUID } from "node:crypto";
import {
  CostCategory,
  CostTarget,
  FulfillmentMode,
  InventoryTxType,
  LotStatus,
  OrderChannel,
  PaymentMethod,
  ProductionMode,
  type PaymentStatus,
  type Prisma,
} from "@prisma/client";
import { lockItemLots, lockLots, lockRow, type Tx } from "@/lib/db";
import { D, money, toDb, type Num, Decimal } from "@/lib/decimal";
import { DomainError, InsufficientStockError, InvalidStateError, NotFoundError } from "@/lib/errors";
import { addDaysDateOnly } from "@/lib/time";
import { audit, type Actor } from "./audit";
import { allocateLotToItem, refreshFulfillment, refreshItemCostSnapshot, requiredUnits } from "./allocation";
import { availableLots, availableOf, consumeReservation, createLot, ensureCoffeeItem, ensureVariantItem, planFifo, post, releaseReservation } from "./inventory";
import { cancelProductionOrder, createProductionOrder } from "./production";
import { nextNumber } from "./sequence";
import { getSettings } from "./settings";

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  UNPAID: "未付款",
  PENDING_CONFIRMATION: "待確認",
  PAID: "已付款",
  REFUNDED: "已退款",
  PARTIALLY_REFUNDED: "部分退款",
};
export const FULFILLMENT_LABEL = {
  PENDING: "待處理",
  AWAITING_PACKAGING: "待分裝",
  READY_TO_SHIP: "可出貨",
  SHIPPED: "已出貨",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  RETURN_PROCESSING: "退貨處理中",
} as const;

export interface CreateOrderInput {
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  shippingAddress?: string | null;
  shippingMethod?: string | null;
  shippingFee?: Num;
  note?: string | null;
  channel?: OrderChannel;
  externalRef?: string | null;
  idempotencyKey?: string | null;
  orderedAt?: Date;
  items: Array<{ variantId: string; quantity: number; discount?: Num }>;
}

export async function createOrder(tx: Tx, input: CreateOrderInput, actor: Actor) {
  if (input.idempotencyKey) {
    const existing = await tx.salesOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { order: existing, duplicate: true };
  }
  if (!input.items.length) throw new DomainError("訂單至少需要一項商品");
  if (!input.customerName.trim()) throw new DomainError("請填寫顧客名稱");
  const settings = await getSettings(tx);
  const taxMode = settings.tax.mode;
  const taxRate = D(settings.tax.rate);

  // 合併相同 SKU
  const merged = new Map<string, { quantity: number; discount: Decimal }>();
  for (const it of input.items) {
    if (!Number.isInteger(it.quantity) || it.quantity <= 0) throw new DomainError("數量必須為正整數");
    const prev = merged.get(it.variantId);
    merged.set(it.variantId, { quantity: (prev?.quantity ?? 0) + it.quantity, discount: (prev?.discount ?? D(0)).add(it.discount ?? 0) });
  }
  const variants = await tx.productVariant.findMany({
    where: { id: { in: [...merged.keys()] } },
    include: { product: true, bundleComponents: true },
  });
  if (variants.length !== merged.size) throw new NotFoundError("商品 SKU");

  // 先鎖定所有相關成品品項的批次（依 itemId 排序，避免死結）
  const involvedVariantIds = new Set<string>();
  for (const v of variants) {
    if (v.status === "ARCHIVED" || v.product.status === "ARCHIVED") throw new DomainError(`${v.sku} 已封存，無法下單`);
    if (v.isBundle) v.bundleComponents.forEach((c) => involvedVariantIds.add(c.componentVariantId));
    else if (v.stockPolicy !== "NOT_TRACKED") involvedVariantIds.add(v.id);
  }
  const items = [];
  for (const vid of involvedVariantIds) items.push(await ensureVariantItem(tx, vid));
  for (const it of [...items].sort((a, b) => a.id.localeCompare(b.id))) await lockItemLots(tx, it.id);

  // 金額
  let subtotal = D(0);
  let discountTotal = D(0);
  let taxTotal = D(0);
  const lines = variants.map((v) => {
    const m = merged.get(v.id)!;
    const gross = D(v.salePrice).mul(m.quantity);
    if (m.discount.isNegative() || m.discount.gt(gross)) throw new DomainError(`${v.sku} 折扣金額不合理`);
    const lineTotal = money(gross.sub(m.discount));
    const tax =
      taxMode === "INCLUSIVE" ? money(lineTotal.sub(lineTotal.div(taxRate.add(1)))) : taxMode === "EXCLUSIVE" ? money(lineTotal.mul(taxRate)) : D(0);
    subtotal = subtotal.add(lineTotal);
    discountTotal = discountTotal.add(m.discount);
    taxTotal = taxTotal.add(tax);
    return { v, quantity: m.quantity, discount: m.discount, lineTotal, tax };
  });
  const shippingFee = money(input.shippingFee ?? 0);
  if (shippingFee.isNegative()) throw new DomainError("運費不可為負");
  const total = subtotal.add(taxMode === "EXCLUSIVE" ? taxTotal : 0).add(shippingFee);

  const order = await tx.salesOrder.create({
    data: {
      orderNo: await nextNumber(tx, "SO"),
      channel: input.channel ?? OrderChannel.MANUAL,
      externalRef: input.externalRef || null,
      idempotencyKey: input.idempotencyKey || null,
      customerId: input.customerId || null,
      customerName: input.customerName.trim(),
      customerPhone: input.customerPhone,
      customerEmail: input.customerEmail,
      shippingAddress: input.shippingAddress,
      shippingMethod: input.shippingMethod,
      orderedAt: input.orderedAt ?? new Date(),
      taxMode,
      taxRate: toDb(taxRate, 4),
      subtotal: toDb(subtotal, 2),
      discountTotal: toDb(discountTotal, 2),
      taxTotal: toDb(taxTotal, 2),
      shippingFee: toDb(shippingFee, 2),
      total: toDb(total, 2),
      note: input.note,
    },
  });

  for (const l of lines) {
    const mode: FulfillmentMode =
      l.v.isBundle ? "STOCK" : l.v.stockPolicy === "NOT_TRACKED" ? "NOT_TRACKED" : "STOCK";
    const oi = await tx.salesOrderItem.create({
      data: {
        orderId: order.id,
        variantId: l.v.id,
        skuSnapshot: l.v.sku,
        nameSnapshot: `${l.v.product.name}｜${l.v.name}`,
        quantity: l.quantity,
        unitPriceSnapshot: l.v.salePrice,
        discount: toDb(l.discount, 2),
        taxAmount: toDb(l.tax, 2),
        lineTotal: toDb(l.lineTotal, 2),
        isBundle: l.v.isBundle,
        fulfillmentMode: mode,
      },
    });
    if (mode === "NOT_TRACKED") continue;

    for (const need of await requiredUnits(tx, oi)) {
      const fg = await ensureVariantItem(tx, need.variantId);
      const lots = await availableLots(tx, fg.id);
      const avail = lots.reduce((s, x) => s.add(availableOf(x)), D(0));
      const fromStock = Decimal.min(avail, need.qty);
      if (fromStock.gt(0)) {
        for (const p of planFifo(lots, fromStock, fg.name)) {
          await allocateLotToItem(tx, { orderItemId: oi.id, variantId: need.variantId, lot: p.lot, qty: p.qty });
        }
      }
      const shortfall = need.qty.sub(fromStock);
      if (shortfall.gt(0)) {
        const cv = need.variantId === l.v.id ? l.v : await tx.productVariant.findUniqueOrThrow({ where: { id: need.variantId }, include: { product: true, bundleComponents: true } });
        if (l.v.isBundle || cv.stockPolicy !== "MADE_TO_ORDER") {
          throw new InsufficientStockError(`${cv.sku} 可售庫存 ${avail} 件，不足訂購 ${need.qty} 件（不可超賣）`);
        }
        await planMadeToOrder(tx, { orderItemId: oi.id, variant: cv, units: shortfall.toNumber(), actor });
        await tx.salesOrderItem.update({ where: { id: oi.id }, data: { fulfillmentMode: "MADE_TO_ORDER" } });
      }
    }
    await refreshItemCostSnapshot(tx, oi.id);
  }

  await refreshFulfillment(tx, order.id);
  await audit(tx, actor, "order.create", "SalesOrder", order.id, `建立訂單 ${order.orderNo}，金額 ${total}`);
  return { order: await tx.salesOrder.findUniqueOrThrow({ where: { id: order.id } }), duplicate: false };
}

/** 接單後分裝：找一個可用量足夠的單一熟豆批次（不混批），建立生產單並預留熟豆 */
async function planMadeToOrder(
  tx: Tx,
  args: { orderItemId: string; variant: { id: string; sku: string; fillWeightG: Prisma.Decimal | null; product: { coffeeId: string | null } }; units: number; actor: Actor },
) {
  const { variant } = args;
  if (!variant.product.coffeeId || !variant.fillWeightG) {
    throw new DomainError(`${variant.sku} 未設定對應咖啡豆或填充重量，無法接單後分裝`);
  }
  const roastedItem = await ensureCoffeeItem(tx, variant.product.coffeeId, "ROASTED");
  await lockItemLots(tx, roastedItem.id);
  const need = D(variant.fillWeightG).mul(args.units);
  const lots = await availableLots(tx, roastedItem.id);
  const src = lots.find((l) => availableOf(l).gte(need));
  if (!src) {
    throw new InsufficientStockError(`${variant.sku} 無現貨，且沒有單一熟豆批次可用量 ≥ ${need}g，無法接單後分裝`);
  }
  return createProductionOrder(
    tx,
    {
      sourceLotId: src.id,
      targetVariantId: variant.id,
      plannedQty: args.units,
      plannedDate: addDaysDateOnly(new Date(), 0),
      mode: ProductionMode.MADE_TO_ORDER,
      salesOrderItemId: args.orderItemId,
      note: "接單後分裝（系統依訂單建立）",
    },
    args.actor,
  );
}

/** 標記顧客已告知匯款，待人工確認 */
export async function markPaymentPending(tx: Tx, orderId: string, actor: Actor, reference?: string) {
  await lockRow(tx, "SalesOrder", orderId);
  const o = await tx.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (o.paymentStatus !== "UNPAID") return o;
  await audit(tx, actor, "order.paymentPending", "SalesOrder", orderId, `顧客回報匯款 ${reference ?? ""}`);
  return tx.salesOrder.update({ where: { id: orderId }, data: { paymentStatus: "PENDING_CONFIRMATION", version: { increment: 1 } } });
}

/** 確認付款（冪等）：已付款則不重複記錄，不異動庫存 */
export async function confirmPayment(
  tx: Tx,
  orderId: string,
  input: { method?: PaymentMethod; amount?: Num; reference?: string | null; note?: string | null; idempotencyKey?: string; paidAt?: Date },
  actor: Actor,
) {
  await lockRow(tx, "SalesOrder", orderId);
  const o = await tx.salesOrder.findUnique({ where: { id: orderId } });
  if (!o) throw new NotFoundError("訂單");
  if (o.fulfillmentStatus === "CANCELLED") throw new InvalidStateError("訂單已取消，不可確認付款");
  if (o.paymentStatus === "PAID" || o.paymentStatus === "REFUNDED" || o.paymentStatus === "PARTIALLY_REFUNDED") {
    return { order: o, alreadyPaid: true };
  }
  const amount = D(input.amount ?? o.total);
  if (!amount.eq(o.total)) throw new DomainError(`付款金額 ${amount} 與訂單金額 ${o.total} 不符`);
  await tx.paymentRecord.create({
    data: {
      orderId,
      type: "PAYMENT",
      method: input.method ?? PaymentMethod.BANK_TRANSFER,
      amount: toDb(amount, 2),
      reference: input.reference,
      note: input.note,
      idempotencyKey: input.idempotencyKey ?? `pay:${orderId}`,
      occurredAt: input.paidAt ?? new Date(),
    },
  });
  const updated = await tx.salesOrder.update({
    where: { id: orderId },
    data: { paymentStatus: "PAID", paidAt: input.paidAt ?? new Date(), version: { increment: 1 } },
  });
  await audit(tx, actor, "order.confirmPayment", "SalesOrder", orderId, `確認付款 ${amount}（${input.reference ?? "無參考號"}）`);
  return { order: updated, alreadyPaid: false };
}

export interface ShipInput {
  method?: string | null;
  carrier?: string | null;
  trackingNo?: string | null;
  shippingCost?: Num;
  shippedAt?: Date;
  note?: string | null;
}

/** 出貨：消耗訂單保留之成品，記錄物流成本 */
export async function shipOrder(tx: Tx, orderId: string, input: ShipInput, actor: Actor) {
  await lockRow(tx, "SalesOrder", orderId);
  const o = await tx.salesOrder.findUnique({
    where: { id: orderId },
    include: { items: { include: { allocations: { where: { status: "RESERVED" } } } } },
  });
  if (!o) throw new NotFoundError("訂單");
  if (o.fulfillmentStatus === "SHIPPED" || o.fulfillmentStatus === "COMPLETED") throw new InvalidStateError("訂單已出貨，不可重複出貨");
  if (o.fulfillmentStatus !== "READY_TO_SHIP") throw new InvalidStateError("訂單尚未備妥（需為「可出貨」狀態）");
  const settings = await getSettings(tx);
  if (settings.order.requirePaymentBeforeShip && o.paymentStatus !== "PAID") throw new InvalidStateError("訂單尚未確認付款，不可出貨");

  const shippedAt = input.shippedAt ?? new Date();
  const groupId = randomUUID();
  for (const it of o.items) {
    for (const a of it.allocations) {
      await consumeReservation(tx, a.reservationId, InventoryTxType.SHIPMENT_ISSUE, {
        actor,
        refType: "SalesOrder",
        refId: o.id,
        groupId,
        note: `出貨 ${o.orderNo}`,
      });
      await tx.orderBatchAllocation.update({ where: { id: a.id }, data: { status: "SHIPPED" } });
    }
  }
  await tx.shipment.create({
    data: {
      orderId,
      method: input.method ?? o.shippingMethod,
      carrier: input.carrier,
      trackingNo: input.trackingNo,
      shippingCost: toDb(input.shippingCost ?? 0, 2),
      shippedAt,
      note: input.note,
    },
  });
  if (input.shippingCost != null && D(input.shippingCost).gt(0)) {
    await tx.costEntry.create({
      data: {
        category: CostCategory.SHIPPING,
        target: CostTarget.SALES_ORDER,
        amount: toDb(input.shippingCost, 2),
        occurredOn: addDaysDateOnly(shippedAt, 0),
        salesOrderId: o.id,
        calcNote: "出貨時輸入之實際物流成本",
      },
    });
  }
  const changed = await tx.salesOrder.updateMany({
    where: { id: orderId, fulfillmentStatus: "READY_TO_SHIP" },
    data: { fulfillmentStatus: "SHIPPED", version: { increment: 1 } },
  });
  if (changed.count !== 1) throw new InvalidStateError("訂單狀態已變更，請重新整理");
  await audit(tx, actor, "order.ship", "SalesOrder", orderId, `出貨 ${o.orderNo} ${input.carrier ?? ""} ${input.trackingNo ?? ""}`);
  return tx.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
}

export async function completeOrder(tx: Tx, orderId: string, actor: Actor) {
  await lockRow(tx, "SalesOrder", orderId);
  const changed = await tx.salesOrder.updateMany({
    where: { id: orderId, fulfillmentStatus: "SHIPPED" },
    data: { fulfillmentStatus: "COMPLETED", completedAt: new Date(), version: { increment: 1 } },
  });
  if (changed.count !== 1) throw new InvalidStateError("僅已出貨的訂單可標記完成");
  await audit(tx, actor, "order.complete", "SalesOrder", orderId, "訂單完成");
}

/** 記錄退款（取消或退貨後） */
export async function recordRefund(tx: Tx, orderId: string, input: { amount: Num; method?: PaymentMethod; reference?: string | null; note?: string | null }, actor: Actor) {
  await lockRow(tx, "SalesOrder", orderId);
  const o = await tx.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (!["PAID", "PARTIALLY_REFUNDED"].includes(o.paymentStatus)) throw new InvalidStateError("僅已付款訂單可退款");
  const amount = money(input.amount);
  if (amount.lte(0)) throw new DomainError("退款金額必須大於 0");
  const refunded = D(o.refundedTotal).add(amount);
  if (refunded.gt(o.total)) throw new DomainError("退款總額不可超過訂單金額");
  await tx.paymentRecord.create({
    data: { orderId, type: "REFUND", method: input.method ?? "BANK_TRANSFER", amount: toDb(amount, 2), reference: input.reference, note: input.note },
  });
  await tx.salesOrder.update({
    where: { id: orderId },
    data: {
      refundedTotal: toDb(refunded, 2),
      paymentStatus: refunded.eq(o.total) ? "REFUNDED" : "PARTIALLY_REFUNDED",
      version: { increment: 1 },
    },
  });
  await audit(tx, actor, "order.refund", "SalesOrder", orderId, `退款 ${amount}`);
}

/** 取消（出貨前）：釋放所有保留、取消未完成的接單後分裝生產單 */
export async function cancelOrder(tx: Tx, orderId: string, input: { reason?: string | null; refundAmount?: Num | null }, actor: Actor) {
  await lockRow(tx, "SalesOrder", orderId);
  const o = await tx.salesOrder.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          allocations: { where: { status: "RESERVED" } },
          productionOrders: { where: { status: "PLANNED" } },
        },
      },
    },
  });
  if (!o) throw new NotFoundError("訂單");
  if (o.fulfillmentStatus === "CANCELLED") return o; // 冪等
  if (!["PENDING", "AWAITING_PACKAGING", "READY_TO_SHIP"].includes(o.fulfillmentStatus)) {
    throw new InvalidStateError("已出貨訂單不可取消，請改辦理退貨");
  }
  for (const it of o.items) {
    for (const a of it.allocations) {
      await releaseReservation(tx, a.reservationId);
      await tx.orderBatchAllocation.update({ where: { id: a.id }, data: { status: "RELEASED" } });
    }
    for (const po of it.productionOrders) await cancelProductionOrder(tx, po.id, actor, { reason: `訂單 ${o.orderNo} 取消`, fromOrder: true });
  }
  await tx.salesOrder.update({
    where: { id: orderId },
    data: { fulfillmentStatus: "CANCELLED", cancelledAt: new Date(), note: [o.note, input.reason && `取消原因：${input.reason}`].filter(Boolean).join("\n") || null, version: { increment: 1 } },
  });
  if (input.refundAmount != null && D(input.refundAmount).gt(0)) await recordRefund(tx, orderId, { amount: input.refundAmount, note: "訂單取消退款" }, actor);
  await audit(tx, actor, "order.cancel", "SalesOrder", orderId, `取消訂單 ${o.orderNo}${input.reason ? "：" + input.reason : ""}`);
  return tx.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
}

/** 建立退貨：退回數量進入待檢批次（QUARANTINE），不增加可售庫存 */
export async function createReturn(tx: Tx, orderId: string, input: { reason?: string | null; items: Array<{ allocationId: string; quantity: Num }> }, actor: Actor) {
  await lockRow(tx, "SalesOrder", orderId);
  const o = await tx.salesOrder.findUnique({ where: { id: orderId } });
  if (!o) throw new NotFoundError("訂單");
  if (!["SHIPPED", "COMPLETED", "RETURN_PROCESSING"].includes(o.fulfillmentStatus)) throw new InvalidStateError("僅已出貨訂單可辦理退貨");
  if (!input.items.length) throw new DomainError("請選擇退貨品項");

  const rr = await tx.returnRecord.create({ data: { returnNo: await nextNumber(tx, "RT"), orderId, reason: input.reason } });
  const groupId = randomUUID();
  for (const ri of input.items) {
    const qty = D(ri.quantity);
    if (qty.lte(0)) throw new DomainError("退貨數量必須大於 0");
    const a = await tx.orderBatchAllocation.findUnique({ where: { id: ri.allocationId }, include: { orderItem: true, lot: true, returnItems: true } });
    if (!a || a.orderItem.orderId !== orderId || a.status !== "SHIPPED") throw new DomainError("退貨品項不屬於此訂單或尚未出貨");
    const already = a.returnItems.reduce((s, x) => s.add(x.quantity), D(0));
    if (already.add(qty).gt(a.quantity)) throw new DomainError(`退貨數量超過已出貨數量（批次 ${a.lot.lotCode}）`);

    const qLot = await createLot(tx, {
      itemId: a.lot.itemId,
      lotCode: `${rr.returnNo}-${a.lot.lotCode}`,
      unitCost: a.unitCost,
      status: LotStatus.QUARANTINE,
      returnSourceLotId: a.lotId,
      producedAt: a.lot.producedAt ?? undefined,
      expiryDate: a.lot.expiryDate,
      expirySource: a.lot.expirySource,
      note: `退貨待檢（${o.orderNo}）`,
    });
    await post(tx, { lotId: qLot.id, type: InventoryTxType.RETURN_QUARANTINE, quantity: qty, refType: "ReturnRecord", refId: rr.id, groupId, actor, note: `退貨 ${rr.returnNo}` });
    await tx.returnItem.create({ data: { returnId: rr.id, allocationId: a.id, quantity: toDb(qty, 3), quarantineLotId: qLot.id } });
  }
  await tx.salesOrder.update({ where: { id: orderId }, data: { fulfillmentStatus: "RETURN_PROCESSING", version: { increment: 1 } } });
  await audit(tx, actor, "order.return", "ReturnRecord", rr.id, `建立退貨 ${rr.returnNo}（訂單 ${o.orderNo}）`);
  return rr;
}

/** 檢查退貨：RESTOCK 重新入庫至原批次（需原批次為可用）；SCRAP 報廢 */
export async function inspectReturnItem(tx: Tx, returnItemId: string, disposition: "RESTOCK" | "SCRAP", actor: Actor, note?: string) {
  const ri = await tx.returnItem.findUnique({ where: { id: returnItemId }, include: { returnRecord: true, allocation: { include: { lot: true } } } });
  if (!ri) throw new NotFoundError("退貨明細");
  await lockRow(tx, "ReturnRecord", ri.returnId);
  const fresh = await tx.returnItem.findUniqueOrThrow({ where: { id: returnItemId } });
  if (fresh.disposition) throw new InvalidStateError("此退貨明細已檢查完成");
  const original = ri.allocation.lot;
  await lockLots(tx, [ri.quarantineLotId, original.id]);
  const groupId = randomUUID();
  const ctx = { refType: "ReturnRecord", refId: ri.returnId, groupId, actor };
  if (disposition === "RESTOCK") {
    if (original.status !== "AVAILABLE") throw new InvalidStateError("原成品批次非可用狀態，無法重新入庫");
    await post(tx, { ...ctx, lotId: ri.quarantineLotId, type: InventoryTxType.RETURN_RESTOCK_OUT, quantity: D(ri.quantity).neg(), note: note ?? "檢查合格，重新入庫" });
    await post(tx, { ...ctx, lotId: original.id, type: InventoryTxType.RETURN_RESTOCK_IN, quantity: ri.quantity, note: note ?? `退貨 ${ri.returnRecord.returnNo} 重新入庫` });
  } else {
    await post(tx, { ...ctx, lotId: ri.quarantineLotId, type: InventoryTxType.SCRAP, quantity: D(ri.quantity).neg(), note: note ?? "退貨檢查不合格，報廢" });
  }
  await tx.returnItem.update({ where: { id: ri.id }, data: { disposition, inspectedAt: new Date(), note } });

  const remaining = await tx.returnItem.count({ where: { returnId: ri.returnId, disposition: null } });
  if (remaining === 0) {
    await tx.returnRecord.update({ where: { id: ri.returnId }, data: { status: "COMPLETED", completedAt: new Date() } });
    const openReturns = await tx.returnRecord.count({ where: { orderId: ri.returnRecord.orderId, status: "PENDING_INSPECTION" } });
    if (openReturns === 0) {
      await tx.salesOrder.update({ where: { id: ri.returnRecord.orderId }, data: { fulfillmentStatus: "COMPLETED", completedAt: new Date(), version: { increment: 1 } } });
    }
  }
  await audit(tx, actor, "return.inspect", "ReturnItem", ri.id, `退貨檢查：${disposition === "RESTOCK" ? "重新入庫" : "報廢"} ${ri.quantity}`);
}

/** 訂單層級直接成本（平台手續費、金流手續費等） */
export async function addOrderCost(tx: Tx, orderId: string, input: { category: CostCategory; amount: Num; isEstimate?: boolean; calcNote?: string | null }, actor: Actor) {
  const allowed: CostCategory[] = ["SHIPPING", "PLATFORM_FEE", "PAYMENT_FEE", "ORDER_OTHER"];
  if (!allowed.includes(input.category)) throw new DomainError("此成本類別不屬於訂單直接成本");
  await tx.costEntry.create({
    data: { category: input.category, target: "SALES_ORDER", amount: toDb(input.amount, 2), isEstimate: input.isEstimate ?? false, occurredOn: addDaysDateOnly(new Date(), 0), salesOrderId: orderId, calcNote: input.calcNote },
  });
  await audit(tx, actor, "order.cost", "SalesOrder", orderId, `新增訂單成本 ${input.category} ${input.amount}`);
}

export { refreshFulfillment };
