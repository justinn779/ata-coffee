import { InventoryTxType } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, toDb, type Num } from "@/lib/decimal";
import { DomainError } from "@/lib/errors";
import { audit, type Actor } from "./audit";
import { createLot, ensureCoffeeItem, post } from "./inventory";
import { nextNumber } from "./sequence";

/** 每克生豆成本 = (採購重量 kg × 每公斤單價 + 運費 + 其他費用) ÷ 實際入庫重量 g */
export function greenCostPerG(i: { purchasedWeightG: Num; unitPricePerKg: Num; shippingCost: Num; otherCost: Num; receivedWeightG: Num }) {
  const received = D(i.receivedWeightG);
  if (received.lte(0)) throw new DomainError("實際入庫重量必須大於 0");
  const goods = D(i.purchasedWeightG).div(1000).mul(i.unitPricePerKg);
  const total = goods.add(i.shippingCost).add(i.otherCost);
  return { total: total.toDecimalPlaces(2), perG: total.div(received).toDecimalPlaces(6) };
}

export interface ReceiveGreenInput {
  coffeeId: string;
  supplierId?: string | null;
  purchaseDate: Date;
  receivedAt: Date;
  invoiceNo?: string | null;
  purchasedWeightG: Num;
  receivedWeightG: Num;
  unitPricePerKg: Num;
  shippingCost?: Num;
  otherCost?: Num;
  moisturePercent?: Num | null;
  densityGPerL?: Num | null;
  waterActivity?: Num | null;
  locationId?: string | null;
  note?: string | null;
  lotCode?: string | null;
}

/** 生豆採購入庫：建立採購單、生豆批次、庫存批次與入庫帳 */
export async function receiveGreenPurchase(tx: Tx, input: ReceiveGreenInput, actor: Actor) {
  const shipping = D(input.shippingCost ?? 0);
  const other = D(input.otherCost ?? 0);
  const cost = greenCostPerG({ ...input, shippingCost: shipping, otherCost: other });

  const purchase = await tx.greenBeanPurchase.create({
    data: {
      purchaseNo: await nextNumber(tx, "PO"),
      supplierId: input.supplierId || null,
      purchaseDate: input.purchaseDate,
      invoiceNo: input.invoiceNo,
      note: input.note,
    },
  });
  const lotCode = input.lotCode?.trim() || (await nextNumber(tx, "GB"));
  const greenLot = await tx.greenBeanLot.create({
    data: {
      lotCode,
      purchaseId: purchase.id,
      coffeeId: input.coffeeId,
      purchasedWeightG: toDb(input.purchasedWeightG, 3),
      receivedWeightG: toDb(input.receivedWeightG, 3),
      unitPricePerKg: toDb(input.unitPricePerKg, 2),
      shippingCost: toDb(shipping, 2),
      otherCost: toDb(other, 2),
      costPerG: toDb(cost.perG, 6),
      moisturePercent: input.moisturePercent == null ? null : toDb(input.moisturePercent, 2),
      densityGPerL: input.densityGPerL == null ? null : toDb(input.densityGPerL, 2),
      waterActivity: input.waterActivity == null ? null : toDb(input.waterActivity, 3),
      locationId: input.locationId || null,
      receivedAt: input.receivedAt,
      note: input.note,
    },
  });
  const item = await ensureCoffeeItem(tx, input.coffeeId, "GREEN");
  const lot = await createLot(tx, {
    itemId: item.id,
    lotCode,
    unitCost: cost.perG,
    locationId: input.locationId,
    greenLotId: greenLot.id,
    producedAt: input.receivedAt,
  });
  await post(tx, {
    lotId: lot.id,
    type: InventoryTxType.RECEIPT,
    quantity: input.receivedWeightG,
    refType: "GreenBeanLot",
    refId: greenLot.id,
    note: `採購 ${purchase.purchaseNo}`,
    actor,
    occurredAt: input.receivedAt,
  });
  await audit(tx, actor, "green.receive", "GreenBeanLot", greenLot.id, `生豆入庫 ${lotCode} ${D(input.receivedWeightG)}g`);
  return { purchase, greenLot, lot, totalCost: cost.total };
}

/**
 * 成本更正：更新生豆批次單價後，以新成本重算剩餘庫存單位成本（僅影響未來交易）。
 * 已建立之烘焙批次、成品與訂單成本快照不受影響。
 */
export async function correctGreenCost(
  tx: Tx,
  greenLotId: string,
  input: { unitPricePerKg: Num; shippingCost?: Num; otherCost?: Num; reason: string },
  actor: Actor,
) {
  if (!input.reason) throw new DomainError("請填寫成本更正原因");
  const g = await tx.greenBeanLot.findUniqueOrThrow({ where: { id: greenLotId } });
  const shipping = D(input.shippingCost ?? g.shippingCost);
  const other = D(input.otherCost ?? g.otherCost);
  const cost = greenCostPerG({ ...g, unitPricePerKg: input.unitPricePerKg, shippingCost: shipping, otherCost: other });
  await tx.greenBeanLot.update({
    where: { id: g.id },
    data: { unitPricePerKg: toDb(input.unitPricePerKg, 2), shippingCost: toDb(shipping, 2), otherCost: toDb(other, 2), costPerG: toDb(cost.perG, 6) },
  });
  await tx.inventoryLot.update({ where: { greenLotId: g.id }, data: { unitCost: toDb(cost.perG, 6) } });
  await audit(tx, actor, "green.costCorrection", "GreenBeanLot", g.id, `成本更正：${g.costPerG} → ${cost.perG} /g；原因：${input.reason}`, {
    before: g.costPerG.toString(),
    after: cost.perG.toString(),
  });
  return cost;
}
