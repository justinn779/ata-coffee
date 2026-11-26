import { D, toDb, type Decimal } from "../../../src/lib/decimal";
import { nowIso, type Tx } from "../tx";
import { C, type InvLot } from "../types";
import { reserve } from "./inventory";

export interface OrderItemDoc {
  id: string;
  orderId: string;
  variantId: string;
  quantity: number;
  isBundle: boolean;
  fulfillmentMode: "STOCK" | "MADE_TO_ORDER" | "NOT_TRACKED" | "PREORDER";
  bundleComponents?: Array<{ variantId: string; quantity: number }>;
  [k: string]: unknown;
}

export interface AllocationDoc {
  id: string;
  orderId: string;
  orderItemId: string;
  variantId: string;
  sku: string;
  lotId: string;
  lotCode: string;
  reservationId: string;
  quantity: string;
  unitCost: string;
  status: "RESERVED" | "SHIPPED" | "RELEASED";
  createdAt: string;
  [k: string]: unknown;
}

export async function allocateLotToItem(tx: Tx, args: { orderId: string; orderItemId: string; variantId: string; sku: string; lot: InvLot; qty: Decimal }) {
  const r = await reserve(tx, { lotId: args.lot.id, quantity: args.qty, purpose: "ORDER", orderItemId: args.orderItemId, orderId: args.orderId });
  return tx.create(C.allocations, {
    orderId: args.orderId,
    orderItemId: args.orderItemId,
    variantId: args.variantId,
    sku: args.sku,
    lotId: args.lot.id,
    lotCode: args.lot.lotCode,
    reservationId: r.id,
    quantity: toDb(args.qty, 3),
    unitCost: args.lot.unitCost,
    status: "RESERVED",
    createdAt: nowIso(),
  }) as unknown as AllocationDoc;
}

/** 依分配重算明細成本快照（批次單位成本於建立時固定） */
export async function refreshItemCostSnapshot(tx: Tx, orderItemId: string) {
  const allocs = (await tx.query<AllocationDoc>(C.allocations, [["orderItemId", "==", orderItemId]])).filter((a) => a.status !== "RELEASED");
  const cost = allocs.reduce((s, a) => s.add(D(a.quantity).mul(a.unitCost)), D(0));
  await tx.update(C.orderItems, orderItemId, { costSnapshot: allocs.length ? toDb(cost, 2) : null });
}

export function requiredUnits(item: OrderItemDoc) {
  if (!item.isBundle) return [{ variantId: item.variantId, qty: D(item.quantity) }];
  return (item.bundleComponents ?? []).map((c) => ({ variantId: c.variantId, qty: D(c.quantity).mul(item.quantity) }));
}

export async function refreshFulfillment(tx: Tx, orderId: string) {
  const order = await tx.must(C.orders, orderId, "訂單");
  const pre = ["PENDING", "AWAITING_PACKAGING", "READY_TO_SHIP"];
  if (!pre.includes(order.fulfillmentStatus as string)) return order.fulfillmentStatus;
  const items = await tx.query<OrderItemDoc>(C.orderItems, [["orderId", "==", orderId]]);
  const allocs = (await tx.query<AllocationDoc>(C.allocations, [["orderId", "==", orderId]])).filter((a) => a.status === "RESERVED");
  let ready = true;
  for (const it of items) {
    if (it.fulfillmentMode === "NOT_TRACKED") continue;
    for (const n of requiredUnits(it)) {
      const got = allocs.filter((a) => a.orderItemId === it.id && a.variantId === n.variantId).reduce((s, a) => s.add(a.quantity), D(0));
      if (got.lessThan(n.qty)) ready = false;
    }
  }
  const next = ready ? "READY_TO_SHIP" : "AWAITING_PACKAGING";
  if (next !== order.fulfillmentStatus) await tx.update(C.orders, orderId, { fulfillmentStatus: next, updatedAt: nowIso() });
  return next;
}
