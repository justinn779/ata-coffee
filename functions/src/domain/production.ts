/**
 * 分裝生產：建立時預留熟豆；完成時於單一交易扣熟豆（耗用＋損耗）、扣包材、產出成品、建立履歷、計算成本。
 * 第一版禁止混批：一張生產單只有單一熟豆來源批次。
 */
import { randomBytes } from "node:crypto";
import { D, toDb, type Num, type Decimal } from "../../../src/lib/decimal";
import { DomainError, InvalidStateError } from "../../../src/lib/errors";
import { addDaysYmd } from "../../../src/lib/time";
import { newId, nowIso, type Tx } from "../tx";
import { C, type Actor, type InvLot, type Reservation } from "../types";
import { audit, nextNumber } from "./core";
import { availableLots, consumeReservation, createLot, ensureMaterialItem, ensureVariantItem, planFifo, post, releaseReservation, reserve } from "./inventory";
import { allocateLotToItem, refreshFulfillment, refreshItemCostSnapshot } from "./allocation";

export interface CreateProductionInput {
  sourceLotId: string;
  targetVariantId: string;
  plannedQty: number;
  fillWeightG?: Num | null;
  plannedDate: string;
  mode?: "PRE_PACK" | "MADE_TO_ORDER";
  orderItemId?: string;
  orderId?: string;
  note?: string | null;
}

export async function createProductionOrder(tx: Tx, input: CreateProductionInput, actor: Actor) {
  if (!Number.isInteger(input.plannedQty) || input.plannedQty <= 0) throw new DomainError("預計生產數量必須為正整數");
  const variant = await tx.must(C.variants, input.targetVariantId, "目標品項");
  if (variant.isBundle) throw new DomainError("套組不需分裝，請分裝其組件單品");
  const fill = D((input.fillWeightG as string) || (variant.fillWeightG as string) || 0);
  if (fill.lte(0)) throw new DomainError("請設定每包填充重量");
  const src = await tx.must<InvLot>(C.lots, input.sourceLotId, "熟豆批次");
  if (src.kind !== "ROASTED") throw new DomainError("來源必須為熟豆批次");
  if (variant.coffeeId && src.coffeeId !== variant.coffeeId) throw new DomainError("熟豆批次的咖啡豆與商品設定不符（第一版禁止未經明確操作的混批或換豆）");
  const orderNo = await nextNumber(tx, "MO");
  const po = tx.create(C.productionOrders, {
    orderNo,
    mode: input.mode ?? "PRE_PACK",
    status: "PLANNED",
    sourceLotId: src.id,
    sourceLotCode: src.lotCode,
    roastBatchId: src.roastBatchId ?? null,
    targetVariantId: variant.id,
    sku: variant.sku,
    variantName: `${variant.productName}｜${variant.name}`,
    plannedQty: input.plannedQty,
    actualQty: null,
    fillWeightG: toDb(fill, 3),
    beansConsumedG: null,
    lossG: null,
    laborCost: null,
    orderItemId: input.orderItemId ?? null,
    orderId: input.orderId ?? null,
    plannedDate: input.plannedDate,
    qualityStatus: "PASS",
    note: input.note ?? null,
    completedAt: null,
    consumptions: [],
    packagingBatchId: null,
    createdAt: nowIso(),
  });
  await reserve(tx, { lotId: src.id, quantity: fill.mul(input.plannedQty), purpose: "PRODUCTION", productionOrderId: po.id, note: `分裝預留 ${orderNo}` });
  audit(tx, actor, "production.create", "ProductionOrder", po.id, `建立分裝單 ${orderNo}：${variant.sku} × ${input.plannedQty}`);
  return po;
}

export interface CompleteProductionInput {
  actualQty: number;
  lossG?: Num | null;
  laborCost?: Num | null;
  laborIsEstimate?: boolean;
  qualityStatus?: "PASS" | "HOLD" | "FAIL";
  completedAt?: string;
  expiryDate?: string | null;
  note?: string | null;
}

export async function completeProductionOrder(tx: Tx, productionOrderId: string, input: CompleteProductionInput, actor: Actor) {
  const po = await tx.must(C.productionOrders, productionOrderId, "分裝生產單");
  if (po.status !== "PLANNED") throw new InvalidStateError(`生產單狀態為 ${po.status}，不可重複完成`);
  if (!Number.isInteger(input.actualQty) || input.actualQty <= 0) throw new DomainError("實際生產數量必須為正整數");
  if (po.mode === "MADE_TO_ORDER" && input.actualQty < (po.plannedQty as number)) throw new DomainError("接單後分裝的實際數量不可少於訂單所需數量");
  const loss = D(input.lossG ?? 0);
  if (loss.isNegative()) throw new DomainError("損耗不可為負");
  const variant = await tx.must(C.variants, po.targetVariantId as string, "目標品項");
  const src = await tx.must<InvLot>(C.lots, po.sourceLotId as string, "熟豆批次");
  const resv = (await tx.query<Reservation>(C.reservations, [["productionOrderId", "==", po.id]])).filter((r) => r.status === "ACTIVE");
  if (resv.length !== 1) throw new InvalidStateError("生產單熟豆預留狀態異常");
  const beans = D(po.fillWeightG as string).mul(input.actualQty);
  const completedAt = input.completedAt ?? nowIso();
  const groupId = newId();
  const ctx = { actor, refType: "ProductionOrder", refId: po.id, groupId };
  const sourceUnitCost = D(src.unitCost);

  // 先讀取包材批次（交易內讀取即鎖定）
  const bom = (variant.materials as Array<{ materialId: string; quantityPerUnit: string }> | undefined) ?? [];
  const matPlans: Array<{ lot: InvLot; qty: Decimal }> = [];
  for (const b of bom) {
    const item = await ensureMaterialItem(tx, b.materialId);
    const need = D(b.quantityPerUnit).mul(input.actualQty);
    matPlans.push(...planFifo(await availableLots(tx, item.id), need, `包材 ${item.name}`));
  }

  await consumeReservation(tx, resv[0].id, "PACKAGING_ISSUE", { ...ctx, consumeQty: beans, note: `分裝 ${po.orderNo}` });
  const consumptions: Array<{ lotId: string; lotCode: string; kind: string; qty: Decimal; unitCost: Decimal }> = [{ lotId: src.id, lotCode: src.lotCode, kind: "BEANS", qty: beans, unitCost: sourceUnitCost }];
  if (loss.gt(0)) {
    await post(tx, { lotId: src.id, type: "PACKAGING_LOSS", quantity: loss.neg(), ...ctx, note: `分裝損耗 ${po.orderNo}` });
    consumptions.push({ lotId: src.id, lotCode: src.lotCode, kind: "LOSS", qty: loss, unitCost: sourceUnitCost });
  }
  for (const p of matPlans) {
    await post(tx, { lotId: p.lot.id, type: "MATERIAL_ISSUE", quantity: p.qty.neg(), ...ctx, note: `分裝 ${po.orderNo}` });
    consumptions.push({ lotId: p.lot.id, lotCode: p.lot.lotCode, kind: "MATERIAL", qty: p.qty, unitCost: D(p.lot.unitCost) });
  }
  let total = D(0);
  const cons = consumptions.map((c) => {
    const lineTotal = c.qty.mul(c.unitCost);
    total = total.add(lineTotal);
    return { lotId: c.lotId, lotCode: c.lotCode, kind: c.kind, quantity: toDb(c.qty, 3), unitCost: toDb(c.unitCost, 6), totalCost: toDb(lineTotal, 2) };
  });
  if (input.laborCost != null && D(input.laborCost).gt(0)) {
    total = total.add(input.laborCost);
    tx.create(C.costs, { category: "PACKAGING_LABOR", target: "PRODUCTION_ORDER", amount: toDb(input.laborCost, 2), isEstimate: input.laborIsEstimate ?? true, occurredOn: addDaysYmd(new Date(completedAt), 0), roastBatchId: null, productionOrderId: po.id, orderId: null, calcNote: null, note: null, createdAt: nowIso() });
  }
  const unitCost = total.div(input.actualQty);
  let expiryDate = input.expiryDate ?? null;
  let expirySource: string | null = input.expiryDate ? "分裝時手動指定" : null;
  if (!expiryDate && src.expiryDate) {
    expiryDate = src.expiryDate;
    expirySource = `沿用熟豆批次（${src.expirySource ?? "設定"}）`;
  }
  const batchNo = await nextNumber(tx, "PK");
  const quality = input.qualityStatus ?? "PASS";
  const pkg = tx.create(C.packagingBatches, { batchNo, productionOrderId: po.id, packagedAt: completedAt, quantity: input.actualQty, totalCost: toDb(total, 2), unitCost: toDb(unitCost, 6), expiryDate, expirySource, sku: variant.sku, roastBatchId: src.roastBatchId ?? null, outputLotId: "", createdAt: nowIso() });
  const fgItem = await ensureVariantItem(tx, variant.id);
  const rb = src.roastBatchId ? await tx.get(C.roastBatches, src.roastBatchId) : null;
  const fgLot = await createLot(tx, { itemId: fgItem.id, lotCode: batchNo, unitCost, status: quality === "PASS" ? "AVAILABLE" : "HOLD", packagingBatchId: pkg.id, producedAt: completedAt, expiryDate, expirySource, variantId: variant.id, note: rb ? `來源烘焙批次 ${rb.batchNo}` : null });
  await tx.update(C.packagingBatches, pkg.id, { outputLotId: fgLot.id });
  await post(tx, { lotId: fgLot.id, type: "PACKAGING_OUTPUT", quantity: input.actualQty, ...ctx, note: `分裝 ${po.orderNo}` });
  const code = randomBytes(6).toString("base64url");
  tx.create(C.traces, { publicCode: code, packagingBatchId: pkg.id, batchNo, sku: variant.sku, productId: variant.productId, isPublished: false, recommendedBrew: null, createdAt: nowIso() });
  await tx.update(C.productionOrders, po.id, { status: "COMPLETED", actualQty: input.actualQty, beansConsumedG: toDb(beans, 3), lossG: toDb(loss, 3), laborCost: input.laborCost == null ? null : toDb(input.laborCost, 2), qualityStatus: quality, completedAt, note: input.note ?? po.note ?? null, consumptions: cons, packagingBatchId: pkg.id, outputLotId: fgLot.id });

  if (po.mode === "MADE_TO_ORDER" && po.orderItemId) {
    if (quality !== "PASS") throw new DomainError("接單後分裝的成品未通過品質檢查，無法分配給訂單");
    await allocateLotToItem(tx, { orderId: po.orderId as string, orderItemId: po.orderItemId as string, variantId: variant.id, sku: variant.sku as string, lot: (await tx.must<InvLot>(C.lots, fgLot.id, "成品批次")), qty: D(po.plannedQty as number) });
    await refreshItemCostSnapshot(tx, po.orderItemId as string);
    await refreshFulfillment(tx, po.orderId as string);
  }
  audit(tx, actor, "production.complete", "ProductionOrder", po.id, `完成分裝 ${po.orderNo}：${input.actualQty} 件，耗豆 ${beans}g，損耗 ${loss}g`);
  return { packagingBatch: { ...pkg, outputLotId: fgLot.id }, lot: fgLot, unitCost: unitCost.toDecimalPlaces(6), totalCost: total.toDecimalPlaces(2) };
}

export async function cancelProductionOrder(tx: Tx, productionOrderId: string, actor: Actor, opts?: { reason?: string | null; fromOrder?: boolean }) {
  const po = await tx.must(C.productionOrders, productionOrderId, "分裝生產單");
  if (po.status !== "PLANNED") throw new InvalidStateError("僅能取消尚未完成的生產單");
  if (po.mode === "MADE_TO_ORDER" && po.orderItemId && !opts?.fromOrder) throw new InvalidStateError("此生產單屬於訂單的接單後分裝，請由訂單取消");
  const resv = (await tx.query<Reservation>(C.reservations, [["productionOrderId", "==", po.id]])).filter((r) => r.status === "ACTIVE");
  for (const r of resv) await releaseReservation(tx, r.id);
  await tx.update(C.productionOrders, po.id, { status: "CANCELLED", note: [po.note, opts?.reason].filter(Boolean).join("；") || null });
  audit(tx, actor, "production.cancel", "ProductionOrder", po.id, `取消分裝單 ${po.orderNo}`);
}
