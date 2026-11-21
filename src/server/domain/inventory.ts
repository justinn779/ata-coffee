/**
 * InventoryService — 庫存核心 Domain。
 *
 * 規則：
 *  1. 任何在庫量變動都必須寫入 InventoryTransaction（帳本，不可修改／刪除，DB trigger 保護）。
 *  2. InventoryLot.onHand / reserved 為帳本衍生快取，只能在本模組於同一 DB 交易中更新。
 *  3. 呼叫端必須先以 lockLots / lockItemLots 取得列鎖（SELECT ... FOR UPDATE）。
 *  4. 可售量 = onHand − reserved，且僅計 status = AVAILABLE 的批次。
 *  5. 已過帳錯誤以 REVERSAL 沖銷交易更正。
 */
import { randomUUID } from "node:crypto";
import {
  InventoryKind,
  InventoryTxType,
  InventoryUnit,
  LotStatus,
  ReservationPurpose,
  type InventoryLot,
  type Prisma,
} from "@prisma/client";
import { lockLots, type Tx } from "@/lib/db";
import { D, toDb, type Num, Decimal } from "@/lib/decimal";
import { DomainError, InsufficientStockError, InvalidStateError, NotFoundError } from "@/lib/errors";
import type { Actor } from "./audit";

export const TX_LABEL: Record<InventoryTxType, string> = {
  RECEIPT: "入庫",
  ROAST_ISSUE: "烘焙領料",
  ROAST_OUTPUT: "烘焙產出",
  CUPPING_USE: "杯測耗用",
  TASTING_USE: "試喝耗用",
  SAMPLE_GIFT: "樣品贈送",
  PACKAGING_ISSUE: "分裝耗用",
  PACKAGING_LOSS: "分裝損耗",
  PACKAGING_OUTPUT: "分裝產出",
  MATERIAL_ISSUE: "包材耗用",
  SCRAP: "報廢",
  ADJUSTMENT: "盤點調整",
  SHIPMENT_ISSUE: "出貨扣帳",
  RETURN_QUARANTINE: "退貨待檢",
  RETURN_RESTOCK_OUT: "退貨轉出待檢區",
  RETURN_RESTOCK_IN: "退貨重新入庫",
  REVERSAL: "沖銷",
};

export const KIND_LABEL: Record<InventoryKind, string> = {
  GREEN: "生豆",
  ROASTED: "熟豆",
  FINISHED: "成品",
  MATERIAL: "包材",
};

/** 使用者可手動過帳的異動類型（其餘只能由業務流程產生） */
export const MANUAL_TX_TYPES = [
  InventoryTxType.CUPPING_USE,
  InventoryTxType.TASTING_USE,
  InventoryTxType.SAMPLE_GIFT,
  InventoryTxType.SCRAP,
  InventoryTxType.ADJUSTMENT,
] as const;
export type ManualTxType = (typeof MANUAL_TX_TYPES)[number];

// ───────────── 品項 ─────────────

export async function ensureCoffeeItem(tx: Tx, coffeeId: string, kind: "GREEN" | "ROASTED") {
  const existing = await tx.inventoryItem.findUnique({ where: { kind_coffeeId: { kind, coffeeId } } });
  if (existing) return existing;
  const coffee = await tx.coffee.findUniqueOrThrow({ where: { id: coffeeId } });
  return tx.inventoryItem.upsert({
    where: { kind_coffeeId: { kind, coffeeId } },
    update: {},
    create: { kind, coffeeId, unit: InventoryUnit.G, name: `${KIND_LABEL[kind]}｜${coffee.nameZh}` },
  });
}

export async function ensureVariantItem(tx: Tx, variantId: string) {
  const existing = await tx.inventoryItem.findUnique({ where: { productVariantId: variantId } });
  if (existing) return existing;
  const v = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId }, include: { product: true } });
  return tx.inventoryItem.upsert({
    where: { productVariantId: variantId },
    update: {},
    create: { kind: InventoryKind.FINISHED, productVariantId: variantId, unit: InventoryUnit.PCS, name: `${v.product.name}｜${v.name}（${v.sku}）` },
  });
}

export async function ensureMaterialItem(tx: Tx, materialId: string) {
  const existing = await tx.inventoryItem.findUnique({ where: { materialId } });
  if (existing) return existing;
  const m = await tx.material.findUniqueOrThrow({ where: { id: materialId } });
  return tx.inventoryItem.upsert({
    where: { materialId },
    update: {},
    create: { kind: InventoryKind.MATERIAL, materialId, unit: InventoryUnit.PCS, name: `${m.name}（${m.code}）` },
  });
}

// ───────────── 批次與過帳 ─────────────

export interface CreateLotInput {
  itemId: string;
  lotCode: string;
  unitCost: Num;
  status?: LotStatus;
  locationId?: string | null;
  greenLotId?: string;
  roastBatchId?: string;
  packagingBatchId?: string;
  returnSourceLotId?: string;
  producedAt?: Date;
  bestByDate?: Date | null;
  expiryDate?: Date | null;
  expirySource?: string | null;
  note?: string | null;
}

export function createLot(tx: Tx, input: CreateLotInput) {
  return tx.inventoryLot.create({
    data: { ...input, unitCost: toDb(input.unitCost, 6), onHand: 0, reserved: 0 },
  });
}

export interface PostInput {
  lotId: string;
  type: InventoryTxType;
  /** 正數 = 增加，負數 = 減少 */
  quantity: Num;
  /** 同時解除之保留量（消耗保留時使用） */
  releaseReserved?: Num;
  refType?: string;
  refId?: string;
  note?: string | null;
  actor: Actor;
  groupId?: string;
  idempotencyKey?: string;
  occurredAt?: Date;
  reversesId?: string;
}

/**
 * 過帳單筆庫存異動。呼叫前必須已鎖定該批次。
 * 減少時不可侵蝕其他保留量：新 onHand ≥ 新 reserved。
 */
export async function post(tx: Tx, input: PostInput) {
  const qty = D(input.quantity);
  if (qty.isZero()) throw new DomainError("異動數量不可為 0");
  const lot = await tx.inventoryLot.findUnique({ where: { id: input.lotId }, include: { item: true } });
  if (!lot) throw new NotFoundError("庫存批次");

  if (input.idempotencyKey) {
    const dup = await tx.inventoryTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (dup) return dup; // 重複送出：回傳原交易，不重複扣帳
  }

  const release = D(input.releaseReserved ?? 0);
  const newOnHand = D(lot.onHand).add(qty);
  const newReserved = D(lot.reserved).sub(release);
  if (newReserved.isNegative()) throw new InvalidStateError("保留量計算錯誤：解除量大於現有保留量");
  if (newOnHand.isNegative()) {
    throw new InsufficientStockError(
      `${lot.item.name}［${lot.lotCode}］庫存不足：在庫 ${fmtQ(lot.onHand)}，欲扣除 ${fmtQ(qty.neg())}`,
    );
  }
  if (newOnHand.lessThan(newReserved)) {
    throw new InsufficientStockError(
      `${lot.item.name}［${lot.lotCode}］可用量不足：在庫 ${fmtQ(lot.onHand)}，其中 ${fmtQ(lot.reserved)} 已保留`,
    );
  }

  await tx.inventoryLot.update({
    where: { id: lot.id },
    data: { onHand: toDb(newOnHand, 3), reserved: toDb(newReserved, 3) },
  });

  return tx.inventoryTransaction.create({
    data: {
      groupId: input.groupId ?? randomUUID(),
      idempotencyKey: input.idempotencyKey,
      itemId: lot.itemId,
      lotId: lot.id,
      type: input.type,
      quantity: toDb(qty, 3),
      unit: lot.item.unit,
      unitCost: lot.unitCost,
      balanceAfter: toDb(newOnHand, 3),
      refType: input.refType,
      refId: input.refId,
      note: input.note ?? null,
      actorId: input.actor.userId,
      occurredAt: input.occurredAt,
      reversesId: input.reversesId,
    },
  });
}

const fmtQ = (v: Num) => D(v).toDecimalPlaces(3).toString();

// ───────────── 保留 ─────────────

export interface ReserveInput {
  lotId: string;
  quantity: Num;
  purpose: ReservationPurpose;
  salesOrderItemId?: string;
  productionOrderId?: string;
  note?: string;
}

/** 保留某批次數量。呼叫前必須已鎖定該批次。 */
export async function reserve(tx: Tx, input: ReserveInput) {
  const qty = D(input.quantity);
  if (qty.lte(0)) throw new DomainError("保留量必須大於 0");
  const lot = await tx.inventoryLot.findUniqueOrThrow({ where: { id: input.lotId }, include: { item: true } });
  if (lot.status !== LotStatus.AVAILABLE) throw new InvalidStateError(`批次 ${lot.lotCode} 非可用狀態，無法保留`);
  const available = D(lot.onHand).sub(lot.reserved);
  if (available.lessThan(qty)) {
    throw new InsufficientStockError(`${lot.item.name}［${lot.lotCode}］可用量 ${fmtQ(available)}，不足保留 ${fmtQ(qty)}`);
  }
  await tx.inventoryLot.update({ where: { id: lot.id }, data: { reserved: toDb(D(lot.reserved).add(qty), 3) } });
  return tx.inventoryReservation.create({
    data: {
      lotId: lot.id,
      quantity: toDb(qty, 3),
      purpose: input.purpose,
      salesOrderItemId: input.salesOrderItemId,
      productionOrderId: input.productionOrderId,
      note: input.note,
    },
  });
}

/** 釋放保留（冪等：已非 ACTIVE 則不動作）。 */
export async function releaseReservation(tx: Tx, reservationId: string): Promise<boolean> {
  const r = await tx.inventoryReservation.findUniqueOrThrow({ where: { id: reservationId } });
  await lockLots(tx, [r.lotId]);
  const changed = await tx.inventoryReservation.updateMany({
    where: { id: reservationId, status: "ACTIVE" },
    data: { status: "RELEASED", releasedAt: new Date() },
  });
  if (changed.count === 0) return false;
  const lot = await tx.inventoryLot.findUniqueOrThrow({ where: { id: r.lotId } });
  await tx.inventoryLot.update({ where: { id: r.lotId }, data: { reserved: toDb(D(lot.reserved).sub(r.quantity), 3) } });
  return true;
}

/**
 * 消耗保留：將保留轉為實際扣帳（出貨、分裝）。
 * consumeQty 可與保留量不同（例如分裝實際用量），差額由可用量補足或回到可用量。
 */
export async function consumeReservation(
  tx: Tx,
  reservationId: string,
  type: InventoryTxType,
  ctx: { actor: Actor; refType: string; refId: string; groupId?: string; note?: string; consumeQty?: Num },
) {
  const r = await tx.inventoryReservation.findUniqueOrThrow({ where: { id: reservationId } });
  await lockLots(tx, [r.lotId]);
  const changed = await tx.inventoryReservation.updateMany({
    where: { id: reservationId, status: "ACTIVE" },
    data: { status: "CONSUMED", consumedAt: new Date() },
  });
  if (changed.count === 0) throw new InvalidStateError("此保留已被使用或釋放，不可重複扣帳");
  const qty = D(ctx.consumeQty ?? r.quantity);
  return post(tx, {
    lotId: r.lotId,
    type,
    quantity: qty.neg(),
    releaseReserved: r.quantity,
    refType: ctx.refType,
    refId: ctx.refId,
    groupId: ctx.groupId,
    note: ctx.note,
    actor: ctx.actor,
  });
}

// ───────────── 查詢 ─────────────

export const availableOf = (lot: Pick<InventoryLot, "onHand" | "reserved">) => D(lot.onHand).sub(lot.reserved);

/** 依 FIFO（效期 → 生產時間 → 建立時間）取得品項可用批次（需已鎖定） */
export async function availableLots(tx: Tx, itemId: string) {
  const lots = await tx.inventoryLot.findMany({
    where: { itemId, status: LotStatus.AVAILABLE },
    orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { producedAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });
  return lots.filter((l) => availableOf(l).gt(0));
}

/** 從多個批次依 FIFO 分配數量；不足則丟出錯誤。回傳 [lot, qty][] */
export function planFifo(lots: InventoryLot[], qty: Num, what: string): Array<{ lot: InventoryLot; qty: Decimal }> {
  let remaining = D(qty);
  const plan: Array<{ lot: InventoryLot; qty: Decimal }> = [];
  for (const lot of lots) {
    if (remaining.lte(0)) break;
    const take = Decimal.min(availableOf(lot), remaining);
    if (take.gt(0)) {
      plan.push({ lot, qty: take });
      remaining = remaining.sub(take);
    }
  }
  if (remaining.gt(0)) {
    const total = lots.reduce((s, l) => s.add(availableOf(l)), D(0));
    throw new InsufficientStockError(`${what} 可用量 ${fmtQ(total)}，不足 ${fmtQ(qty)}`);
  }
  return plan;
}

/** 手動異動（杯測、試喝、樣品、報廢、盤點調整） */
export async function manualAdjust(
  tx: Tx,
  input: { lotId: string; type: ManualTxType; quantity: Num; note?: string; actor: Actor; idempotencyKey?: string },
) {
  if (!MANUAL_TX_TYPES.includes(input.type)) throw new DomainError("此異動類型不可手動建立");
  const q = D(input.quantity);
  if (input.type !== InventoryTxType.ADJUSTMENT && q.gte(0)) throw new DomainError("耗用、贈送、報廢數量應為負數（扣除）");
  if (input.type === InventoryTxType.ADJUSTMENT && !input.note) throw new DomainError("盤點調整必須填寫原因");
  await lockLots(tx, [input.lotId]);
  return post(tx, { ...input, refType: "MANUAL" });
}

/** 沖銷一筆手動異動（建立反向交易，原交易保留） */
export async function reverseTransaction(tx: Tx, txId: string, actor: Actor, note: string) {
  const orig = await tx.inventoryTransaction.findUnique({ where: { id: txId }, include: { reversedBy: true } });
  if (!orig) throw new NotFoundError("庫存交易");
  if (orig.reversedBy) throw new InvalidStateError("此交易已被沖銷");
  if (orig.type === InventoryTxType.REVERSAL) throw new InvalidStateError("沖銷交易不可再沖銷");
  if (!(MANUAL_TX_TYPES as readonly string[]).includes(orig.type) && orig.type !== InventoryTxType.RECEIPT) {
    throw new InvalidStateError("業務流程產生的交易請由原流程（取消、退貨等）處理");
  }
  await lockLots(tx, [orig.lotId]);
  return post(tx, {
    lotId: orig.lotId,
    type: InventoryTxType.REVERSAL,
    quantity: D(orig.quantity).neg(),
    refType: "REVERSAL",
    refId: orig.id,
    reversesId: orig.id,
    note,
    actor,
  });
}

/** 對帳：每個批次 onHand 必須等於帳本加總；reserved 必須等於 ACTIVE 保留加總。回傳不一致清單。 */
export async function reconcile(tx: Tx | Prisma.TransactionClient) {
  return tx.$queryRaw<Array<{ lotCode: string; onHand: string; ledger: string; reserved: string; activeResv: string }>>`
    SELECT l."lotCode", l."onHand"::text, COALESCE(t.sum, 0)::text AS ledger,
           l.reserved::text, COALESCE(r.sum, 0)::text AS "activeResv"
    FROM "InventoryLot" l
    LEFT JOIN (SELECT "lotId", SUM(quantity) sum FROM "InventoryTransaction" GROUP BY "lotId") t ON t."lotId" = l.id
    LEFT JOIN (SELECT "lotId", SUM(quantity) sum FROM "InventoryReservation" WHERE status = 'ACTIVE' GROUP BY "lotId") r ON r."lotId" = l.id
    WHERE l."onHand" <> COALESCE(t.sum, 0) OR l.reserved <> COALESCE(r.sum, 0)`;
}

/** 品項彙總（在庫、保留、可用、成本） */
export async function itemSummaries(tx: Tx, kind?: InventoryKind) {
  return tx.$queryRaw<
    Array<{ itemId: string; name: string; kind: InventoryKind; unit: InventoryUnit; onHand: string; reserved: string; available: string; quarantine: string; value: string; lowStockThreshold: string | null }>
  >`
    SELECT i.id AS "itemId", i.name, i.kind, i.unit, i."lowStockThreshold"::text,
      COALESCE(SUM(l."onHand") FILTER (WHERE l.status = 'AVAILABLE'), 0)::text AS "onHand",
      COALESCE(SUM(l.reserved) FILTER (WHERE l.status = 'AVAILABLE'), 0)::text AS reserved,
      COALESCE(SUM(l."onHand" - l.reserved) FILTER (WHERE l.status = 'AVAILABLE'), 0)::text AS available,
      COALESCE(SUM(l."onHand") FILTER (WHERE l.status = 'QUARANTINE'), 0)::text AS quarantine,
      COALESCE(SUM(l."onHand" * l."unitCost"), 0)::text AS value
    FROM "InventoryItem" i
    LEFT JOIN "InventoryLot" l ON l."itemId" = i.id
    WHERE i."isActive" AND (${kind ?? null}::"InventoryKind" IS NULL OR i.kind = ${kind ?? null}::"InventoryKind")
    GROUP BY i.id
    ORDER BY i.kind, i.name`;
}
