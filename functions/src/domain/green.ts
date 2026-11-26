import { D, toDb, type Num } from "../../../src/lib/decimal";
import { DomainError } from "../../../src/lib/errors";
import { nowIso, type Tx } from "../tx";
import { confirmOr, warn } from "../soft";
import { C, type Actor, type InvLot } from "../types";
import { audit, nextNumber } from "./core";
import { createLot, ensureCoffeeItem, post } from "./inventory";
import { recostRoastBatch } from "./roasting";

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

// ───────────── 修改／刪除生豆採購 ─────────────

/**
 * 修改生豆採購：
 * - 入庫數量變動時，以差額調整生豆庫存（不可低於已被烘焙用掉的量）。
 * - 成本（重量、單價、運費、其他）變動時更新每克成本，並重算「熟豆尚未分裝出貨」的烘焙批次成本。
 * - 批次編號、供應商、咖啡豆（尚未烘焙時）等顯示資訊，同步到烘焙紀錄與庫存批次。
 */
export async function updateGreenPurchase(tx: Tx, greenLotId: string, input: ReceiveGreenInput, actor: Actor) {
  const g = await tx.must(C.greenLots, greenLotId, "生豆批次");
  if (D(input.purchasedWeightG).lte(0) || D(input.receivedWeightG).lte(0)) throw new DomainError("採購與入庫重量必須大於 0");
  const shipping = D(input.shippingCost ?? 0);
  const other = D(input.otherCost ?? 0);
  const cost = greenCostPerG({ ...input, shippingCost: shipping, otherCost: other });
  const roasts = await tx.query(C.roastBatches, [["greenLotId", "==", g.id]]);
  const coffee = await tx.must(C.coffees, input.coffeeId, "咖啡豆");
  if (input.coffeeId !== g.coffeeId && roasts.length) warn(`這批生豆已有 ${roasts.length} 筆烘焙紀錄，那些烘焙批次仍記在原本的咖啡豆「${g.coffeeName}」；需要的話請到烘焙紀錄改選`);
  const supplier = input.supplierId ? await tx.must(C.suppliers, input.supplierId, "供應商") : null;
  const lot = await tx.must<InvLot>(C.lots, g.invLotId as string, "生豆庫存批次");
  const lotCode = input.lotCode?.trim() || (g.lotCode as string);
  const used = D(g.receivedWeightG as string).sub(lot.onHand);
  if (D(input.receivedWeightG).lt(used)) warn(`入庫量 ${input.receivedWeightG}g 少於已用掉的 ${used}g，生豆庫存會變成負數`);
  if (lotCode !== g.lotCode && (await tx.query(C.greenLots, [["lotCode", "==", lotCode]])).length) throw new DomainError(`批次編號 ${lotCode} 已存在`);
  const diff = D(input.receivedWeightG).sub(g.receivedWeightG as string);
  if (!diff.isZero()) await post(tx, { lotId: lot.id, type: "RECEIPT", quantity: diff, refType: "GreenBeanLot", refId: g.id, note: `修改採購 ${g.purchaseNo}：入庫量 ${g.receivedWeightG}g → ${input.receivedWeightG}g`, actor, occurredAt: input.receivedAt });
  const item = await ensureCoffeeItem(tx, input.coffeeId, "GREEN");
  await tx.update(C.lots, lot.id, { itemId: item.id, itemName: item.name, coffeeId: input.coffeeId, lotCode, unitCost: toDb(cost.perG, 6), locationId: input.locationId ?? null, producedAt: input.receivedAt, updatedAt: nowIso() });
  await tx.update(C.greenLots, g.id, {
    lotCode,
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
    updatedAt: nowIso(),
  });
  if (g.purchaseId && (await tx.get(C.greenPurchases, g.purchaseId as string))) await tx.update(C.greenPurchases, g.purchaseId as string, { supplierId: input.supplierId ?? null, supplierName: supplier?.name ?? null, purchaseDate: input.purchaseDate, invoiceNo: input.invoiceNo ?? null, note: input.note ?? null });
  let recosted = 0;
  for (const rb of roasts) {
    if (rb.greenLotCode !== lotCode) await tx.update(C.roastBatches, rb.id, { greenLotCode: lotCode });
    if (!D(g.costPerG as string).eq(cost.perG) && (await recostRoastBatch(tx, rb, cost.perG))) recosted++;
  }
  audit(tx, actor, "green.update", "GreenBeanLot", g.id, `修改生豆採購 ${lotCode}${diff.isZero() ? "" : `，入庫量調整 ${diff.toString()}g`}${recosted ? `，重算 ${recosted} 批烘焙成本` : ""}`);
  return { recosted };
}

/**
 * 刪除生豆採購：已烘焙時先提醒，確認後只刪這筆採購；烘焙紀錄保留原本的生豆批號，標示「生豆採購已刪除」。
 * 剩餘的生豆庫存歸零、庫存批次作廢（帳本保留）。
 */
export async function deleteGreenPurchase(tx: Tx, greenLotId: string, actor: Actor) {
  const g = await tx.must(C.greenLots, greenLotId, "生豆批次");
  const roasts = await tx.query(C.roastBatches, [["greenLotId", "==", g.id]]);
  const lot = await tx.get<InvLot>(C.lots, g.invLotId as string);
  const txs = lot ? await tx.query(C.txs, [["lotId", "==", lot.id]]) : [];
  const others = txs.filter((t) => t.type !== "RECEIPT" && !(t.refType === "RoastBatch"));
  const notes = [roasts.length ? `${roasts.length} 筆烘焙紀錄（會保留，標示生豆採購已刪除）` : "", others.length ? `${others.length} 筆盤點、報廢等庫存異動（帳本保留）` : ""].filter(Boolean);
  if (notes.length) confirmOr(`這批生豆 ${g.lotCode} 還有 ${notes.join("、")}。確定只刪除這筆採購嗎？`);
  for (const rb of roasts) await tx.update(C.roastBatches, rb.id, { greenLotId: null, greenLotDeleted: true, updatedAt: nowIso() });
  if (lot) {
    if (!D(lot.onHand).isZero()) await post(tx, { lotId: lot.id, type: "RECEIPT", quantity: D(lot.onHand).neg(), refType: "GreenBeanLot", refId: g.id, note: `刪除採購 ${g.purchaseNo}`, actor });
    await tx.update(C.lots, lot.id, { status: "SCRAPPED", note: `採購 ${g.purchaseNo} 已刪除`, updatedAt: nowIso() });
  }
  const siblings = g.purchaseId ? await tx.query(C.greenLots, [["purchaseId", "==", g.purchaseId]]) : [];
  if (g.purchaseId && siblings.length <= 1 && (await tx.get(C.greenPurchases, g.purchaseId as string))) await tx.delete(C.greenPurchases, g.purchaseId as string);
  await tx.delete(C.greenLots, g.id);
  audit(tx, actor, "green.delete", "GreenBeanLot", g.id, `刪除生豆採購 ${g.lotCode}（${g.coffeeName}，${g.receivedWeightG}g）`);
}
