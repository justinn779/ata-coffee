/**
 * 分裝生產：建立時預留熟豆；完成時於單一交易扣熟豆（耗用＋損耗）、扣包材、產出成品、建立履歷、計算成本。
 * 第一版禁止混批：一張生產單只有單一熟豆來源批次。
 */
import { randomBytes } from "node:crypto";
import { D, toDb, type Num, type Decimal } from "../../../src/lib/decimal";
import { DomainError, InvalidStateError } from "../../../src/lib/errors";
import { addDaysYmd } from "../../../src/lib/time";
import { newId, nowIso, type Tx } from "../tx";
import { confirmOr, warn } from "../soft";
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
  if (variant.coffeeId && src.coffeeId !== variant.coffeeId) warn(`熟豆批次 ${src.lotCode}（${src.itemName}）跟商品 ${variant.sku} 設定的咖啡豆不同，請確認沒有選錯`);
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
  if (po.mode === "MADE_TO_ORDER" && input.actualQty < (po.plannedQty as number)) confirmOr(`實際數量 ${input.actualQty} 少於訂單需要的 ${po.plannedQty} 件，訂單會缺貨。仍要完成嗎？`);
  const loss = D(input.lossG ?? 0);
  if (loss.isNegative()) throw new DomainError("損耗不可為負");
  const variant = await tx.must(C.variants, po.targetVariantId as string, "目標品項");
  const src = await tx.must<InvLot>(C.lots, po.sourceLotId as string, "熟豆批次");
  const resv = (await tx.query<Reservation>(C.reservations, [["productionOrderId", "==", po.id]])).filter((r) => r.status === "ACTIVE");
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
    matPlans.push(...planFifo(await availableLots(tx, item.id, true), need, `包材 ${item.name}`));
  }

  for (const r of resv.slice(1)) await releaseReservation(tx, r.id);
  if (resv[0]) await consumeReservation(tx, resv[0].id, "PACKAGING_ISSUE", { ...ctx, consumeQty: beans, note: `分裝 ${po.orderNo}` });
  else await post(tx, { lotId: src.id, type: "PACKAGING_ISSUE", quantity: beans.neg(), ...ctx, note: `分裝 ${po.orderNo}` });
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
    if (quality !== "PASS") confirmOr("接單後分裝的成品沒有通過品質檢查，仍要分配給訂單嗎？");
    await allocateLotToItem(tx, { orderId: po.orderId as string, orderItemId: po.orderItemId as string, variantId: variant.id, sku: variant.sku as string, lot: (await tx.must<InvLot>(C.lots, fgLot.id, "成品批次")), qty: D(Math.min(input.actualQty, po.plannedQty as number)) });
    await refreshItemCostSnapshot(tx, po.orderItemId as string);
    await refreshFulfillment(tx, po.orderId as string);
  }
  audit(tx, actor, "production.complete", "ProductionOrder", po.id, `完成分裝 ${po.orderNo}：${input.actualQty} 件，耗豆 ${beans}g，損耗 ${loss}g`);
  return { packagingBatch: { ...pkg, outputLotId: fgLot.id }, lot: fgLot, unitCost: unitCost.toDecimalPlaces(6), totalCost: total.toDecimalPlaces(2) };
}

export async function cancelProductionOrder(tx: Tx, productionOrderId: string, actor: Actor, opts?: { reason?: string | null; fromOrder?: boolean }) {
  const po = await tx.must(C.productionOrders, productionOrderId, "分裝生產單");
  if (po.status !== "PLANNED") throw new InvalidStateError("僅能取消尚未完成的生產單（已完成的請用「撤銷完成」）");
  if (po.mode === "MADE_TO_ORDER" && po.orderItemId && !opts?.fromOrder) confirmOr("這張分裝單是訂單的接單後分裝，取消後訂單會缺貨（訂單本身不會取消）。仍要取消嗎？");
  const resv = (await tx.query<Reservation>(C.reservations, [["productionOrderId", "==", po.id]])).filter((r) => r.status === "ACTIVE");
  for (const r of resv) await releaseReservation(tx, r.id);
  await tx.update(C.productionOrders, po.id, { status: "CANCELLED", note: [po.note, opts?.reason].filter(Boolean).join("；") || null });
  audit(tx, actor, "production.cancel", "ProductionOrder", po.id, `取消分裝單 ${po.orderNo}`);
}

// ───────────── 修改／撤銷／刪除分裝生產單 ─────────────

/** 修改規劃中的生產單（數量、單包重量、日期、備註）；重新計算熟豆預留 */
export async function updateProductionOrder(tx: Tx, productionOrderId: string, input: { plannedQty: number; fillWeightG?: Num | null; plannedDate: string; note?: string | null }, actor: Actor) {
  const po = await tx.must(C.productionOrders, productionOrderId, "分裝生產單");
  if (po.status !== "PLANNED") throw new InvalidStateError("已完成的生產單請先「撤銷完成」再修改");
  if (po.mode === "MADE_TO_ORDER" && input.plannedQty < (po.plannedQty as number)) confirmOr(`數量 ${input.plannedQty} 少於訂單需要的 ${po.plannedQty} 件，訂單會缺貨。仍要修改嗎？`);
  if (!Number.isInteger(input.plannedQty) || input.plannedQty <= 0) throw new DomainError("預計生產數量必須為正整數");
  const fill = D((input.fillWeightG as string) || (po.fillWeightG as string));
  if (fill.lte(0)) throw new DomainError("請設定每包填充重量");
  const resv = (await tx.query<Reservation>(C.reservations, [["productionOrderId", "==", po.id]])).filter((r) => r.status === "ACTIVE");
  for (const r of resv) await releaseReservation(tx, r.id);
  await reserve(tx, { lotId: po.sourceLotId as string, quantity: fill.mul(input.plannedQty), purpose: "PRODUCTION", productionOrderId: po.id, note: `分裝預留 ${po.orderNo}` });
  await tx.update(C.productionOrders, po.id, { plannedQty: input.plannedQty, fillWeightG: toDb(fill, 3), plannedDate: input.plannedDate, note: input.note ?? null, updatedAt: nowIso() });
  audit(tx, actor, "production.update", "ProductionOrder", po.id, `修改分裝單 ${po.orderNo}：${input.plannedQty} 件 × ${fill}g`);
}

/**
 * 撤銷完成：把已完成的生產單退回「規劃中」——熟豆、損耗、包材全部退回庫存，成品批次扣回，
 * 包裝批次、QR 履歷、分裝人工成本一併刪除，並重新預留熟豆，之後可修改再完成。
 * 成品已出貨、保留給訂單或有其他異動時不可撤銷。
 */
export async function reopenProductionOrder(tx: Tx, productionOrderId: string, actor: Actor) {
  const po = await tx.must(C.productionOrders, productionOrderId, "分裝生產單");
  if (po.status !== "COMPLETED") throw new InvalidStateError("只有已完成的生產單可以撤銷");
  const fg = await tx.must<InvLot>(C.lots, po.outputLotId as string, "成品批次");
  const fgTxs = await tx.query(C.txs, [["lotId", "==", fg.id]]);
  const fgUsed = D(fg.reserved).gt(0) || fgTxs.some((t) => !(t.refType === "ProductionOrder" && t.refId === po.id));
  if (po.mode === "MADE_TO_ORDER" || fgUsed) confirmOr(`${po.mode === "MADE_TO_ORDER" ? "這批成品是接單後分裝，已分配給訂單；" : ""}${fgUsed ? "這批成品已被訂單保留、出貨或有其他異動；" : ""}撤銷後成品批次作廢，已出貨的帳不變，訂單的保留會解除。仍要撤銷嗎？`);
  // 解除訂單對這批成品的保留，訂單回到待備貨
  const fgResv = (await tx.query<Reservation>(C.reservations, [["lotId", "==", fg.id]])).filter((r) => r.status === "ACTIVE");
  const touchedOrders = new Set<string>();
  for (const r of fgResv) {
    await releaseReservation(tx, r.id);
    for (const a of await tx.query(C.allocations, [["reservationId", "==", r.id]])) {
      await tx.update(C.allocations, a.id, { status: "RELEASED" });
      touchedOrders.add(a.orderId as string);
      await refreshItemCostSnapshot(tx, a.orderItemId as string);
    }
  }
  for (const oid of touchedOrders) await refreshFulfillment(tx, oid);
  const groupId = newId();
  const ctx = { actor, refType: "ProductionOrder", refId: po.id, groupId };
  const note = `撤銷分裝 ${po.orderNo}`;
  const fgNow = await tx.must<InvLot>(C.lots, fg.id, "成品批次");
  if (D(fgNow.onHand).gt(0)) await post(tx, { lotId: fg.id, type: "PACKAGING_OUTPUT", quantity: D(fgNow.onHand).neg(), ...ctx, note });
  await tx.update(C.lots, fg.id, { status: "SCRAPPED", note: `${note}（成品批次作廢）`, updatedAt: nowIso() });
  const typeOf: Record<string, "PACKAGING_ISSUE" | "PACKAGING_LOSS" | "MATERIAL_ISSUE"> = { BEANS: "PACKAGING_ISSUE", LOSS: "PACKAGING_LOSS", MATERIAL: "MATERIAL_ISSUE" };
  for (const c of (po.consumptions as Array<{ lotId: string; kind: string; quantity: string }>) ?? []) await post(tx, { lotId: c.lotId, type: typeOf[c.kind] ?? "ADJUSTMENT", quantity: c.quantity, ...ctx, note: `${note}：退回` });
  if (po.packagingBatchId) {
    for (const t of await tx.query(C.traces, [["packagingBatchId", "==", po.packagingBatchId]])) {
      if (await tx.get(C.publicTraces, t.publicCode as string)) await tx.delete(C.publicTraces, t.publicCode as string);
      await tx.delete(C.traces, t.id);
    }
    await tx.delete(C.packagingBatches, po.packagingBatchId as string);
  }
  for (const c of await tx.query(C.costs, [["productionOrderId", "==", po.id]])) await tx.delete(C.costs, c.id);
  await reserve(tx, { lotId: po.sourceLotId as string, quantity: D(po.fillWeightG as string).mul(po.plannedQty as number), purpose: "PRODUCTION", productionOrderId: po.id, note: `分裝預留 ${po.orderNo}` });
  await tx.update(C.productionOrders, po.id, { status: "PLANNED", actualQty: null, beansConsumedG: null, lossG: null, laborCost: null, completedAt: null, consumptions: [], packagingBatchId: null, outputLotId: null, updatedAt: nowIso() });
  audit(tx, actor, "production.reopen", "ProductionOrder", po.id, `${note}：熟豆與包材已退回庫存`);
}

/** 刪除生產單：已完成的先撤銷；規劃中的釋放熟豆預留後刪除 */
export async function deleteProductionOrder(tx: Tx, productionOrderId: string, actor: Actor) {
  const po = await tx.must(C.productionOrders, productionOrderId, "分裝生產單");
  if (po.mode === "MADE_TO_ORDER" && po.status !== "CANCELLED") confirmOr("這張分裝單是訂單的接單後分裝，刪除後訂單會缺貨（訂單本身不會刪除）。仍要刪除嗎？");
  if (po.status === "COMPLETED") await reopenProductionOrder(tx, po.id, actor);
  for (const r of (await tx.query<Reservation>(C.reservations, [["productionOrderId", "==", po.id]])).filter((r) => r.status === "ACTIVE")) await releaseReservation(tx, r.id);
  await tx.delete(C.productionOrders, po.id);
  audit(tx, actor, "production.delete", "ProductionOrder", po.id, `刪除分裝單 ${po.orderNo}`);
}
