import { FulfillmentStatus, ReservationPurpose } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, toDb, Decimal } from "@/lib/decimal";
import { reserve } from "./inventory";
import type { InventoryLot } from "@prisma/client";

/** 將特定成品批次保留並分配給訂單明細（呼叫前需已鎖定批次） */
export async function allocateLotToItem(
  tx: Tx,
  args: { orderItemId: string; variantId: string; lot: InventoryLot; qty: Decimal },
) {
  const r = await reserve(tx, {
    lotId: args.lot.id,
    quantity: args.qty,
    purpose: ReservationPurpose.ORDER,
    salesOrderItemId: args.orderItemId,
  });
  return tx.orderBatchAllocation.create({
    data: {
      orderItemId: args.orderItemId,
      variantId: args.variantId,
      lotId: args.lot.id,
      reservationId: r.id,
      quantity: toDb(args.qty, 3),
      unitCost: args.lot.unitCost,
    },
  });
}

/** 依分配結果重算明細成本快照（批次單位成本於建立時固定，因此快照不隨日後成本變動） */
export async function refreshItemCostSnapshot(tx: Tx, orderItemId: string) {
  const allocs = await tx.orderBatchAllocation.findMany({ where: { orderItemId, status: { not: "RELEASED" } } });
  const cost = allocs.reduce((s, a) => s.add(D(a.quantity).mul(a.unitCost)), D(0));
  await tx.salesOrderItem.update({ where: { id: orderItemId }, data: { costSnapshot: allocs.length ? toDb(cost, 2) : null } });
}

/** 明細需要的成品件數（套組依組件展開） */
export async function requiredUnits(tx: Tx, item: { variantId: string; quantity: number; isBundle: boolean }) {
  if (!item.isBundle) return [{ variantId: item.variantId, qty: D(item.quantity) }];
  const comps = await tx.productBundleComponent.findMany({ where: { bundleVariantId: item.variantId } });
  return comps.map((c) => ({ variantId: c.componentVariantId, qty: D(c.quantity).mul(item.quantity) }));
}

/** 依各明細分配是否齊全，更新訂單履約狀態（僅限出貨前狀態） */
export async function refreshFulfillment(tx: Tx, orderId: string) {
  const order = await tx.salesOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { include: { allocations: { where: { status: "RESERVED" } } } } },
  });
  const preShip: FulfillmentStatus[] = ["PENDING", "AWAITING_PACKAGING", "READY_TO_SHIP"];
  if (!preShip.includes(order.fulfillmentStatus)) return order.fulfillmentStatus;
  let allReady = true;
  for (const it of order.items) {
    if (it.fulfillmentMode === "NOT_TRACKED") continue;
    const need = await requiredUnits(tx, it);
    for (const n of need) {
      const got = it.allocations.filter((a) => a.variantId === n.variantId).reduce((s, a) => s.add(a.quantity), D(0));
      if (got.lessThan(n.qty)) allReady = false;
    }
  }
  const next = allReady ? FulfillmentStatus.READY_TO_SHIP : FulfillmentStatus.AWAITING_PACKAGING;
  if (next !== order.fulfillmentStatus) {
    await tx.salesOrder.update({ where: { id: orderId }, data: { fulfillmentStatus: next, version: { increment: 1 } } });
  }
  return next;
}
