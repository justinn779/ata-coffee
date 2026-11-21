import { D, toDb, type Num } from "../../../src/lib/decimal";
import { DomainError } from "../../../src/lib/errors";
import { nowIso, type Tx } from "../tx";
import { C, type Actor, type InvLot } from "../types";
import { audit, nextNumber } from "./core";
import { createLot, ensureCoffeeItem, post } from "./inventory";

/** 每克生豆成本 = (採購重量 kg × 每公斤單價 + 運費 + 其他) ÷ 實際入庫 g */
export function greenCostPerG(i: { purchasedWeightG: Num; unitPricePerKg: Num; shippingCost: Num; otherCost: Num; receivedWeightG: Num }) {
  const received = D(i.receivedWeightG);
  if (received.lte(0)) throw new DomainError("實際入庫重量必須大於 0");
  const total = D(i.purchasedWeightG).div(1000).mul(i.unitPricePerKg).add(i.shippingCost).add(i.otherCost);
  return { total: total.toDecimalPlaces(2), perG: total.div(received).toDecimalPlaces(6) };
}

export interface ReceiveGreenInput {
  coffeeId: string;
  supplierId?: string | null;
  purchaseDate: string;
  receivedAt: string;
  invoiceNo?: string | null;
  purchasedWeightG: Num;
  receivedWeightG: Num;
  unitPricePerKg: Num;
  shippingCost?: Num | null;
  otherCost?: Num | null;
  moisturePercent?: Num | null;
  densityGPerL?: Num | null;
  waterActivity?: Num | null;
  locationId?: string | null;
  note?: string | null;
  lotCode?: string | null;
}

const opt = (v: Num | null | undefined, dp: number) => (v == null || v === "" ? null : toDb(v, dp));

export async function receiveGreenPurchase(tx: Tx, input: ReceiveGreenInput, actor: Actor) {
  if (D(input.purchasedWeightG).lte(0) || D(input.receivedWeightG).lte(0)) throw new DomainError("採購與入庫重量必須大於 0");
  if (D(input.unitPricePerKg).isNegative()) throw new DomainError("單價不可為負");
  const shipping = D(input.shippingCost ?? 0);
  const other = D(input.otherCost ?? 0);
  const cost = greenCostPerG({ ...input, shippingCost: shipping, otherCost: other });
  const coffee = await tx.must(C.coffees, input.coffeeId, "咖啡豆");
  const supplier = input.supplierId ? await tx.must(C.suppliers, input.supplierId, "供應商") : null;
  const purchaseNo = await nextNumber(tx, "PO");
  const purchase = tx.create(C.greenPurchases, { purchaseNo, supplierId: input.supplierId ?? null, supplierName: supplier?.name ?? null, purchaseDate: input.purchaseDate, invoiceNo: input.invoiceNo ?? null, note: input.note ?? null, createdAt: nowIso() });
  const lotCode = input.lotCode?.trim() || (await nextNumber(tx, "GB"));
  const item = await ensureCoffeeItem(tx, input.coffeeId, "GREEN");
  const greenLot = tx.create(C.greenLots, {
    lotCode,
    purchaseId: purchase.id,
    purchaseNo,
    purchaseDate: input.purchaseDate,
    supplierId: input.supplierId ?? null,
    supplierName: supplier?.name ?? null,
    invoiceNo: input.invoiceNo ?? null,
    coffeeId: input.coffeeId,
    coffeeName: coffee.nameZh,
    purchasedWeightG: toDb(input.purchasedWeightG, 3),
    receivedWeightG: toDb(input.receivedWeightG, 3),
    unitPricePerKg: toDb(input.unitPricePerKg, 2),
    shippingCost: toDb(shipping, 2),
    otherCost: toDb(other, 2),
    costPerG: toDb(cost.perG, 6),
    moisturePercent: opt(input.moisturePercent, 2),
    densityGPerL: opt(input.densityGPerL, 2),
    waterActivity: opt(input.waterActivity, 3),
    locationId: input.locationId ?? null,
    note: input.note ?? null,
    receivedAt: input.receivedAt,
    createdAt: nowIso(),
    invLotId: "",
  });
  const lot = await createLot(tx, { itemId: item.id, lotCode, unitCost: cost.perG, locationId: input.locationId, greenLotId: greenLot.id, producedAt: input.receivedAt, coffeeId: input.coffeeId });
  await tx.update(C.greenLots, greenLot.id, { invLotId: lot.id });
  await post(tx, { lotId: lot.id, type: "RECEIPT", quantity: input.receivedWeightG, refType: "GreenBeanLot", refId: greenLot.id, note: `採購 ${purchaseNo}`, actor, occurredAt: input.receivedAt });
  audit(tx, actor, "green.receive", "GreenBeanLot", greenLot.id, `生豆入庫 ${lotCode} ${D(input.receivedWeightG)}g`);
  return { purchase, greenLot: { ...greenLot, invLotId: lot.id }, lot, totalCost: cost.total };
}

/** 成本更正：只影響此批剩餘庫存之後續交易；歷史批次與訂單快照不變 */
export async function correctGreenCost(tx: Tx, greenLotId: string, input: { unitPricePerKg: Num; shippingCost?: Num | null; otherCost?: Num | null; reason: string }, actor: Actor) {
  if (!input.reason) throw new DomainError("請填寫成本更正原因");
  const g = await tx.must(C.greenLots, greenLotId, "生豆批次");
  const shipping = D(input.shippingCost ?? (g.shippingCost as string));
  const other = D(input.otherCost ?? (g.otherCost as string));
  const cost = greenCostPerG({ purchasedWeightG: g.purchasedWeightG as string, receivedWeightG: g.receivedWeightG as string, unitPricePerKg: input.unitPricePerKg, shippingCost: shipping, otherCost: other });
  await tx.update(C.greenLots, g.id, { unitPricePerKg: toDb(input.unitPricePerKg, 2), shippingCost: toDb(shipping, 2), otherCost: toDb(other, 2), costPerG: toDb(cost.perG, 6) });
  await tx.must<InvLot>(C.lots, g.invLotId as string, "庫存批次");
  await tx.update(C.lots, g.invLotId as string, { unitCost: toDb(cost.perG, 6), updatedAt: nowIso() });
  audit(tx, actor, "green.costCorrection", "GreenBeanLot", g.id, `成本更正：${g.costPerG} → ${cost.perG.toString()} /g；原因：${input.reason}`, { before: g.costPerG, after: cost.perG.toString() });
  return cost;
}
