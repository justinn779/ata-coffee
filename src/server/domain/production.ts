/**
 * 分裝生產 Domain：預先分裝（PRE_PACK）與接單後分裝（MADE_TO_ORDER）。
 * 建立生產單時即保留熟豆（避免被其他生產單重複使用）；完成時於單一交易中：
 *   扣熟豆（分裝耗用 + 分裝損耗）、扣包材、新增成品批次、建立履歷、計算成品成本。
 * 第一版禁止混批：一張生產單只能有單一熟豆來源批次。
 */
import { randomUUID } from "node:crypto";
import {
  CostCategory,
  CostTarget,
  InventoryTxType,
  LotStatus,
  ProductionMode,
  QualityStatus,
  ReservationPurpose,
} from "@prisma/client";
import { lockLots, lockRow, type Tx } from "@/lib/db";
import { D, toDb, type Num } from "@/lib/decimal";
import { DomainError, InvalidStateError, NotFoundError } from "@/lib/errors";
import { addDaysDateOnly } from "@/lib/time";
import { audit, type Actor } from "./audit";
import {
  availableLots,
  consumeReservation,
  createLot,
  ensureMaterialItem,
  ensureVariantItem,
  planFifo,
  post,
  releaseReservation,
  reserve,
} from "./inventory";
import { allocateLotToItem, refreshFulfillment, refreshItemCostSnapshot } from "./allocation";
import { nextNumber } from "./sequence";
import { randomBytes } from "node:crypto";

export interface CreateProductionInput {
  sourceLotId: string; // 熟豆庫存批次
  targetVariantId: string;
  plannedQty: number;
  fillWeightG?: Num | null; // 未填則使用 SKU 預設填充重量（濾掛可自訂）
  plannedDate: Date;
  mode?: ProductionMode;
  salesOrderItemId?: string;
  note?: string | null;
}

export async function createProductionOrder(tx: Tx, input: CreateProductionInput, actor: Actor) {
  if (!Number.isInteger(input.plannedQty) || input.plannedQty <= 0) throw new DomainError("預計生產數量必須為正整數");
  const variant = await tx.productVariant.findUnique({ where: { id: input.targetVariantId }, include: { product: true } });
  if (!variant) throw new NotFoundError("目標 SKU");
  if (variant.isBundle) throw new DomainError("套組不需分裝，請分裝其組件單品");
  const fill = D(input.fillWeightG ?? variant.fillWeightG ?? 0);
  if (fill.lte(0)) throw new DomainError("請設定每包填充重量");

  await lockLots(tx, [input.sourceLotId]);
  const src = await tx.inventoryLot.findUnique({ where: { id: input.sourceLotId }, include: { item: true, roastBatch: true } });
  if (!src || src.item.kind !== "ROASTED") throw new DomainError("來源必須為熟豆批次");
  if (variant.product.coffeeId && src.item.coffeeId !== variant.product.coffeeId) {
    throw new DomainError("熟豆批次的咖啡豆與商品設定不符（第一版禁止未經明確操作的混批或換豆）");
  }

  const orderNo = await nextNumber(tx, "MO");
  const po = await tx.productionOrder.create({
    data: {
      orderNo,
      mode: input.mode ?? ProductionMode.PRE_PACK,
      sourceLotId: src.id,
      targetVariantId: variant.id,
      plannedQty: input.plannedQty,
      fillWeightG: toDb(fill, 3),
      plannedDate: input.plannedDate,
      salesOrderItemId: input.salesOrderItemId,
      note: input.note,
    },
  });
  // 預留熟豆：計畫數量 × 填充重量
  await reserve(tx, {
    lotId: src.id,
    quantity: fill.mul(input.plannedQty),
    purpose: ReservationPurpose.PRODUCTION,
    productionOrderId: po.id,
    note: `分裝預留 ${orderNo}`,
  });
  await audit(tx, actor, "production.create", "ProductionOrder", po.id, `建立分裝單 ${orderNo}：${variant.sku} × ${input.plannedQty}`);
  return po;
}

export interface CompleteProductionInput {
  actualQty: number;
  lossG?: Num; // 額外包裝損耗（g）
  laborCost?: Num | null;
  laborIsEstimate?: boolean;
  qualityStatus?: QualityStatus;
  completedAt?: Date;
  expiryDate?: Date | null; // 手動指定商品標示有效日期（優先）
  note?: string | null;
}

export async function completeProductionOrder(tx: Tx, productionOrderId: string, input: CompleteProductionInput, actor: Actor) {
  await lockRow(tx, "ProductionOrder", productionOrderId);
  const po = await tx.productionOrder.findUnique({
    where: { id: productionOrderId },
    include: {
      reservations: { where: { status: "ACTIVE" } },
      targetVariant: { include: { materials: true, product: true } },
      sourceLot: { include: { roastBatch: { include: { greenLot: { include: { coffee: true } } } } } },
    },
  });
  if (!po) throw new NotFoundError("分裝生產單");
  if (po.status !== "PLANNED") throw new InvalidStateError(`生產單狀態為 ${po.status}，不可重複完成`);
  if (!Number.isInteger(input.actualQty) || input.actualQty <= 0) throw new DomainError("實際生產數量必須為正整數");
  if (po.mode === "MADE_TO_ORDER" && input.actualQty < po.plannedQty) {
    throw new DomainError("接單後分裝的實際數量不可少於訂單所需數量");
  }
  const loss = D(input.lossG ?? 0);
  if (loss.isNegative()) throw new DomainError("損耗不可為負");
  const beans = D(po.fillWeightG).mul(input.actualQty);
  const completedAt = input.completedAt ?? new Date();
  const groupId = randomUUID();
  const ctx = { actor, refType: "ProductionOrder", refId: po.id, groupId };

  // 1) 熟豆：消耗保留（實際用量可多於或少於預留，差額由可用量補足或釋回）
  await lockLots(tx, [po.sourceLotId]);
  const sourceUnitCost = D(po.sourceLot.unitCost);
  if (po.reservations.length !== 1) throw new InvalidStateError("生產單熟豆預留狀態異常");
  await consumeReservation(tx, po.reservations[0].id, InventoryTxType.PACKAGING_ISSUE, { ...ctx, consumeQty: beans, note: `分裝 ${po.orderNo}` });
  const consumptions: Array<{ lotId: string; kind: "BEANS" | "LOSS" | "MATERIAL"; qty: ReturnType<typeof D>; unitCost: ReturnType<typeof D> }> = [
    { lotId: po.sourceLotId, kind: "BEANS", qty: beans, unitCost: sourceUnitCost },
  ];
  if (loss.gt(0)) {
    await post(tx, { lotId: po.sourceLotId, type: InventoryTxType.PACKAGING_LOSS, quantity: loss.neg(), ...ctx, note: `分裝損耗 ${po.orderNo}` });
    consumptions.push({ lotId: po.sourceLotId, kind: "LOSS", qty: loss, unitCost: sourceUnitCost });
  }

  // 2) 包材：依 SKU 包材 BOM × 實際數量，FIFO 扣除
  for (const bom of po.targetVariant.materials) {
    const item = await ensureMaterialItem(tx, bom.materialId);
    const need = D(bom.quantityPerUnit).mul(input.actualQty);
    await tx.$queryRaw`SELECT id FROM "InventoryLot" WHERE "itemId" = ${item.id}::uuid ORDER BY id FOR UPDATE`;
    const plan = planFifo(await availableLots(tx, item.id), need, `包材 ${item.name}`);
    for (const p of plan) {
      await post(tx, { lotId: p.lot.id, type: InventoryTxType.MATERIAL_ISSUE, quantity: p.qty.neg(), ...ctx, note: `分裝 ${po.orderNo}` });
      consumptions.push({ lotId: p.lot.id, kind: "MATERIAL", qty: p.qty, unitCost: D(p.lot.unitCost) });
    }
  }

  // 3) 成本
  let total = D(0);
  for (const c of consumptions) {
    const lineTotal = c.qty.mul(c.unitCost);
    total = total.add(lineTotal);
    await tx.productionConsumption.create({
      data: { productionOrderId: po.id, lotId: c.lotId, kind: c.kind, quantity: toDb(c.qty, 3), unitCost: toDb(c.unitCost, 6), totalCost: toDb(lineTotal, 2) },
    });
  }
  if (input.laborCost != null && D(input.laborCost).gt(0)) {
    total = total.add(input.laborCost);
    await tx.costEntry.create({
      data: {
        category: CostCategory.PACKAGING_LABOR,
        target: CostTarget.PRODUCTION_ORDER,
        amount: toDb(input.laborCost, 2),
        isEstimate: input.laborIsEstimate ?? true,
        occurredOn: addDaysDateOnly(completedAt, 0),
        productionOrderId: po.id,
      },
    });
  }
  const unitCost = total.div(input.actualQty);

  // 4) 效期：手動 > 烘焙批次覆寫 > 咖啡豆預設（以烘焙日起算）
  const rb = po.sourceLot.roastBatch;
  let expiryDate: Date | null = input.expiryDate ?? null;
  let expirySource: string | null = input.expiryDate ? "分裝時手動指定" : null;
  if (!expiryDate && po.sourceLot.expiryDate) {
    expiryDate = po.sourceLot.expiryDate;
    expirySource = `沿用熟豆批次（${po.sourceLot.expirySource ?? "設定"}）`;
  }

  // 5) 成品批次
  const batchNo = await nextNumber(tx, "PK");
  const pkg = await tx.packagingBatch.create({
    data: {
      batchNo,
      productionOrderId: po.id,
      packagedAt: completedAt,
      quantity: input.actualQty,
      totalCost: toDb(total, 2),
      unitCost: toDb(unitCost, 6),
      expiryDate,
      expirySource,
    },
  });
  const fgItem = await ensureVariantItem(tx, po.targetVariantId);
  const quality = input.qualityStatus ?? QualityStatus.PASS;
  const fgLot = await createLot(tx, {
    itemId: fgItem.id,
    lotCode: batchNo,
    unitCost,
    status: quality === "PASS" ? LotStatus.AVAILABLE : LotStatus.HOLD,
    packagingBatchId: pkg.id,
    producedAt: completedAt,
    expiryDate,
    expirySource,
    note: rb ? `來源烘焙批次 ${rb.batchNo}` : undefined,
  });
  await post(tx, { lotId: fgLot.id, type: InventoryTxType.PACKAGING_OUTPUT, quantity: input.actualQty, ...ctx, note: `分裝 ${po.orderNo}` });

  await tx.productTraceability.create({ data: { publicCode: randomBytes(6).toString("base64url"), packagingBatchId: pkg.id } });

  const changed = await tx.productionOrder.updateMany({
    where: { id: po.id, status: "PLANNED" },
    data: {
      status: "COMPLETED",
      actualQty: input.actualQty,
      beansConsumedG: toDb(beans, 3),
      lossG: toDb(loss, 3),
      laborCost: input.laborCost == null ? null : toDb(input.laborCost, 2),
      qualityStatus: quality,
      completedAt,
      note: input.note ?? po.note,
      version: { increment: 1 },
    },
  });
  if (changed.count !== 1) throw new InvalidStateError("生產單已被其他操作更新，請重新整理");

  // 6) 接單後分裝：將成品分配給指定訂單明細
  if (po.mode === "MADE_TO_ORDER" && po.salesOrderItemId) {
    if (quality !== "PASS") throw new DomainError("接單後分裝的成品未通過品質檢查，無法分配給訂單");
    await lockLots(tx, [fgLot.id]);
    const lot = await tx.inventoryLot.findUniqueOrThrow({ where: { id: fgLot.id } });
    await allocateLotToItem(tx, { orderItemId: po.salesOrderItemId, variantId: po.targetVariantId, lot, qty: D(po.plannedQty) });
    await refreshItemCostSnapshot(tx, po.salesOrderItemId);
    const item = await tx.salesOrderItem.findUniqueOrThrow({ where: { id: po.salesOrderItemId } });
    await refreshFulfillment(tx, item.orderId);
  }

  await audit(tx, actor, "production.complete", "ProductionOrder", po.id, `完成分裝 ${po.orderNo}：${input.actualQty} 件，耗豆 ${beans}g，損耗 ${loss}g`);
  return { packagingBatch: pkg, lot: fgLot, unitCost: unitCost.toDecimalPlaces(6), totalCost: total.toDecimalPlaces(2) };
}

export async function cancelProductionOrder(
  tx: Tx,
  productionOrderId: string,
  actor: Actor,
  opts?: { reason?: string; fromOrder?: boolean },
) {
  await lockRow(tx, "ProductionOrder", productionOrderId);
  const po = await tx.productionOrder.findUniqueOrThrow({ where: { id: productionOrderId }, include: { reservations: { where: { status: "ACTIVE" } } } });
  if (po.status !== "PLANNED") throw new InvalidStateError("僅能取消尚未完成的生產單");
  if (po.mode === "MADE_TO_ORDER" && po.salesOrderItemId && !opts?.fromOrder) {
    throw new InvalidStateError("此生產單屬於訂單的接單後分裝，請由訂單取消");
  }
  for (const r of po.reservations) await releaseReservation(tx, r.id);
  await tx.productionOrder.update({ where: { id: po.id }, data: { status: "CANCELLED", note: [po.note, opts?.reason].filter(Boolean).join("；") || null } });
  await audit(tx, actor, "production.cancel", "ProductionOrder", po.id, `取消分裝單 ${po.orderNo}`);
}
