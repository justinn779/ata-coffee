/**
 * InventoryService — 庫存核心 Domain（Firestore 版）。
 *
 *  1. 所有在庫量變動必須寫入帳本 invTxs（安全規則禁止用戶端寫入；帳本只新增不修改）。
 *  2. invLots.onHand / reserved 只能在同一交易中與帳本一起更新；reconcile() 驗證與帳本加總一致。
 *  3. 交易中讀取批次即取得鎖（Admin SDK 交易），並行交易會序列化或重試。
 *  4. 可售量 = onHand − reserved，僅計 AVAILABLE 批次。
 *  5. 錯誤以 REVERSAL 沖銷交易更正。
 */
import type { Firestore } from "firebase-admin/firestore";
import { D, toDb, type Num, Decimal } from "../../../src/lib/decimal";
import { DomainError, InsufficientStockError, InvalidStateError } from "../../../src/lib/errors";
import { nowIso, newId, type Tx } from "../tx";
import { C, type Actor, type InventoryKind, type InvItem, type InvLot, type InvTx, type LotStatus, type Reservation, type TxType } from "../types";

export const TX_LABEL: Record<TxType, string> = {
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
export const KIND_LABEL: Record<InventoryKind, string> = { GREEN: "生豆", ROASTED: "熟豆", FINISHED: "成品", MATERIAL: "包材" };
export const MANUAL_TX_TYPES = ["CUPPING_USE", "TASTING_USE", "SAMPLE_GIFT", "SCRAP", "ADJUSTMENT"] as const;
export type ManualTxType = (typeof MANUAL_TX_TYPES)[number];

const fmtQ = (v: Num) => D(v).toDecimalPlaces(3).toString();

// ───────────── 品項（固定 id 避免重複） ─────────────

export async function ensureCoffeeItem(tx: Tx, coffeeId: string, kind: "GREEN" | "ROASTED"): Promise<InvItem> {
  const id = `coffee-${kind.toLowerCase()}-${coffeeId}`;
  const existing = await tx.get<InvItem>(C.items, id);
  if (existing) return existing;
  const coffee = await tx.must(C.coffees, coffeeId, "咖啡豆");
  return tx.set(C.items, id, { kind, coffeeId, unit: "G", name: `${KIND_LABEL[kind]}｜${coffee.nameZh}`, isActive: true, lowStockThreshold: null, createdAt: nowIso() }) as InvItem;
}

export async function ensureVariantItem(tx: Tx, variantId: string): Promise<InvItem> {
  const id = `variant-${variantId}`;
  const existing = await tx.get<InvItem>(C.items, id);
  if (existing) return existing;
  const v = await tx.must(C.variants, variantId, "商品品項");
  return tx.set(C.items, id, { kind: "FINISHED", variantId, unit: "PCS", name: `${v.productName}｜${v.name}（${v.sku}）`, isActive: true, lowStockThreshold: null, createdAt: nowIso() }) as InvItem;
}

export async function ensureMaterialItem(tx: Tx, materialId: string): Promise<InvItem> {
  const id = `material-${materialId}`;
  const existing = await tx.get<InvItem>(C.items, id);
  if (existing) return existing;
  const m = await tx.must(C.materials, materialId, "包材");
  return tx.set(C.items, id, { kind: "MATERIAL", materialId, unit: "PCS", name: `${m.name}（${m.code}）`, isActive: true, lowStockThreshold: null, createdAt: nowIso() }) as InvItem;
}

// ───────────── 批次 ─────────────

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
  producedAt?: string;
  expiryDate?: string | null;
  expirySource?: string | null;
  note?: string | null;
  coffeeId?: string | null;
  variantId?: string | null;
}

export async function createLot(tx: Tx, input: CreateLotInput): Promise<InvLot> {
  const item = await tx.must<InvItem>(C.items, input.itemId, "庫存品項");
  await tx.claimUnique("lotCode", input.lotCode, `批次編號 ${input.lotCode} 已存在`);
  const now = nowIso();
  return tx.create(C.lots, {
    ...input,
    kind: item.kind,
    unit: item.unit,
    itemName: item.name,
    coffeeId: input.coffeeId ?? item.coffeeId ?? null,
    variantId: input.variantId ?? item.variantId ?? null,
    status: input.status ?? "AVAILABLE",
    unitCost: toDb(input.unitCost, 6),
    onHand: "0",
    reserved: "0",
    createdAt: now,
    updatedAt: now,
  }) as unknown as InvLot;
}

// ───────────── 過帳 ─────────────

export interface PostInput {
  lotId: string;
  type: TxType;
  quantity: Num;
  releaseReserved?: Num;
  refType?: string;
  refId?: string;
  note?: string | null;
  actor: Actor;
  groupId?: string;
  idempotencyKey?: string;
  occurredAt?: string;
  reversesId?: string;
}

export async function post(tx: Tx, input: PostInput): Promise<InvTx> {
  const qty = D(input.quantity);
  if (qty.isZero()) throw new DomainError("異動數量不可為 0");
  if (input.idempotencyKey) {
    const dup = await tx.query<InvTx>(C.txs, [["idempotencyKey", "==", input.idempotencyKey]]);
    if (dup.length) return dup[0];
  }
  const lot = await tx.must<InvLot>(C.lots, input.lotId, "庫存批次");
  const release = D(input.releaseReserved ?? 0);
  const newOnHand = D(lot.onHand).add(qty);
  const newReserved = D(lot.reserved).sub(release);
  if (newReserved.isNegative()) throw new InvalidStateError("保留量計算錯誤：解除量大於現有保留量");
  if (newOnHand.isNegative()) throw new InsufficientStockError(`${lot.itemName}［${lot.lotCode}］庫存不足：在庫 ${fmtQ(lot.onHand)}，欲扣除 ${fmtQ(qty.neg())}`);
  if (newOnHand.lessThan(newReserved)) throw new InsufficientStockError(`${lot.itemName}［${lot.lotCode}］可用量不足：在庫 ${fmtQ(lot.onHand)}，其中 ${fmtQ(lot.reserved)} 已保留`);
  const now = nowIso();
  await tx.update(C.lots, lot.id, { onHand: toDb(newOnHand, 3), reserved: toDb(newReserved, 3), updatedAt: now });
  return tx.create(C.txs, {
    groupId: input.groupId ?? newId(),
    idempotencyKey: input.idempotencyKey ?? null,
    itemId: lot.itemId,
    lotId: lot.id,
    kind: lot.kind,
    lotCode: lot.lotCode,
    itemName: lot.itemName,
    type: input.type,
    quantity: toDb(qty, 3),
    unit: lot.unit,
    unitCost: lot.unitCost,
    balanceAfter: toDb(newOnHand, 3),
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    note: input.note ?? null,
    actorId: input.actor.userId,
    actorName: input.actor.name ?? null,
    reversesId: input.reversesId ?? null,
    reversedById: null,
    occurredAt: input.occurredAt ?? now,
  }) as unknown as InvTx;
}

// ───────────── 保留 ─────────────

export interface ReserveInput {
  lotId: string;
  quantity: Num;
  purpose: "ORDER" | "PRODUCTION";
  orderItemId?: string;
  orderId?: string;
  productionOrderId?: string;
  note?: string;
}

export async function reserve(tx: Tx, input: ReserveInput): Promise<Reservation> {
  const qty = D(input.quantity);
  if (qty.lte(0)) throw new DomainError("保留量必須大於 0");
  const lot = await tx.must<InvLot>(C.lots, input.lotId, "庫存批次");
  if (lot.status !== "AVAILABLE") throw new InvalidStateError(`批次 ${lot.lotCode} 非可用狀態，無法保留`);
  const available = D(lot.onHand).sub(lot.reserved);
  if (available.lessThan(qty)) throw new InsufficientStockError(`${lot.itemName}［${lot.lotCode}］可用量 ${fmtQ(available)}，不足保留 ${fmtQ(qty)}`);
  await tx.update(C.lots, lot.id, { reserved: toDb(D(lot.reserved).add(qty), 3), updatedAt: nowIso() });
  return tx.create(C.reservations, {
    lotId: lot.id,
    lotCode: lot.lotCode,
    quantity: toDb(qty, 3),
    purpose: input.purpose,
    status: "ACTIVE",
    orderItemId: input.orderItemId ?? null,
    orderId: input.orderId ?? null,
    productionOrderId: input.productionOrderId ?? null,
    note: input.note ?? null,
    createdAt: nowIso(),
    releasedAt: null,
    consumedAt: null,
  }) as unknown as Reservation;
}

/** 釋放保留（冪等） */
export async function releaseReservation(tx: Tx, reservationId: string): Promise<boolean> {
  const r = await tx.must<Reservation>(C.reservations, reservationId, "保留");
  if (r.status !== "ACTIVE") return false;
  const lot = await tx.must<InvLot>(C.lots, r.lotId, "庫存批次");
  await tx.update(C.reservations, r.id, { status: "RELEASED", releasedAt: nowIso() });
  await tx.update(C.lots, lot.id, { reserved: toDb(D(lot.reserved).sub(r.quantity), 3), updatedAt: nowIso() });
  return true;
}

/** 消耗保留：轉為實際扣帳；consumeQty 可與保留量不同 */
export async function consumeReservation(
  tx: Tx,
  reservationId: string,
  type: TxType,
  ctx: { actor: Actor; refType: string; refId: string; groupId?: string; note?: string; consumeQty?: Num },
) {
  const r = await tx.must<Reservation>(C.reservations, reservationId, "保留");
  if (r.status !== "ACTIVE") throw new InvalidStateError("此保留已被使用或釋放，不可重複扣帳");
  await tx.update(C.reservations, r.id, { status: "CONSUMED", consumedAt: nowIso() });
  return post(tx, { lotId: r.lotId, type, quantity: D(ctx.consumeQty ?? r.quantity).neg(), releaseReserved: r.quantity, refType: ctx.refType, refId: ctx.refId, groupId: ctx.groupId, note: ctx.note, actor: ctx.actor });
}

// ───────────── 查詢 ─────────────

export const availableOf = (lot: Pick<InvLot, "onHand" | "reserved">) => D(lot.onHand).sub(lot.reserved);

/** 品項可用批次（FIFO：效期 → 生產時間 → 建立時間）；查詢即鎖定這些批次 */
export async function availableLots(tx: Tx, itemId: string) {
  const lots = await tx.query<InvLot>(C.lots, [["itemId", "==", itemId], ["status", "==", "AVAILABLE"]]);
  const k = (v?: string | null) => v ?? "9999";
  lots.sort((a, b) => k(a.expiryDate).localeCompare(k(b.expiryDate)) || k(a.producedAt).localeCompare(k(b.producedAt)) || a.createdAt.localeCompare(b.createdAt));
  return lots.filter((l) => availableOf(l).gt(0));
}

export function planFifo(lots: InvLot[], qty: Num, what: string): Array<{ lot: InvLot; qty: Decimal }> {
  let remaining = D(qty);
  const plan: Array<{ lot: InvLot; qty: Decimal }> = [];
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

export async function manualAdjust(tx: Tx, input: { lotId: string; type: ManualTxType; quantity: Num; note?: string | null; actor: Actor; idempotencyKey?: string }) {
  if (!(MANUAL_TX_TYPES as readonly string[]).includes(input.type)) throw new DomainError("此異動類型不可手動建立");
  const q = D(input.quantity);
  if (input.type !== "ADJUSTMENT" && q.gte(0)) throw new DomainError("耗用、贈送、報廢數量應為負數（扣除）");
  if (input.type === "ADJUSTMENT" && !input.note) throw new DomainError("盤點調整必須填寫原因");
  return post(tx, { ...input, refType: "MANUAL" });
}

export async function reverseTransaction(tx: Tx, txId: string, actor: Actor, note: string) {
  const orig = await tx.must<InvTx>(C.txs, txId, "庫存交易");
  if (orig.reversedById) throw new InvalidStateError("此交易已被沖銷");
  if (orig.type === "REVERSAL") throw new InvalidStateError("沖銷交易不可再沖銷");
  if (!([...MANUAL_TX_TYPES, "RECEIPT"] as string[]).includes(orig.type)) throw new InvalidStateError("業務流程產生的交易請由原流程（取消、退貨等）處理");
  const rev = await post(tx, { lotId: orig.lotId, type: "REVERSAL", quantity: D(orig.quantity).neg(), refType: "REVERSAL", refId: orig.id, reversesId: orig.id, note, actor });
  // 帳本只新增不修改；以 uniq 佔位標記「已沖銷」，並在原交易外的索引集合記錄關聯
  await tx.claimUnique("reversal", orig.id, "此交易已被沖銷");
  tx.set("invTxReversals", orig.id, { reversedById: rev.id, at: nowIso() });
  return rev;
}

// ───────────── 對帳與彙總（非交易讀取） ─────────────

async function all<T>(db: Firestore, col: string): Promise<T[]> {
  const s = await db.collection(col).get();
  return s.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as T);
}

export async function reconcile(db: Firestore) {
  const [lots, txs, resv] = await Promise.all([all<InvLot>(db, C.lots), all<InvTx>(db, C.txs), all<Reservation>(db, C.reservations)]);
  const ledger = new Map<string, Decimal>();
  for (const t of txs) ledger.set(t.lotId, (ledger.get(t.lotId) ?? D(0)).add(t.quantity));
  const active = new Map<string, Decimal>();
  for (const r of resv) if (r.status === "ACTIVE") active.set(r.lotId, (active.get(r.lotId) ?? D(0)).add(r.quantity));
  return lots
    .filter((l) => !D(l.onHand).eq(ledger.get(l.id) ?? 0) || !D(l.reserved).eq(active.get(l.id) ?? 0) || D(l.onHand).isNegative() || D(l.reserved).gt(l.onHand))
    .map((l) => ({ lotCode: l.lotCode, onHand: l.onHand, ledger: (ledger.get(l.id) ?? D(0)).toString(), reserved: l.reserved, activeResv: (active.get(l.id) ?? D(0)).toString() }));
}

export { all as readAll };
