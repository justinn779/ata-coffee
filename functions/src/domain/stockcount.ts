/**
 * 整批盤點：一次輸入多個批次的實盤數量，系統以「實盤 − 帳面」產生盤點調整（ADJUSTMENT）交易。
 *  - 同一交易內完成：任一批次有問題（盤點期間異動、低於保留量）整批不生效
 *  - 帳面數量以送出時的資料庫為準；若與畫面載入時不同，代表盤點期間有出貨等異動，要求重新載入
 *  - countId 冪等：重複送出不會重複調整
 */
import { D, toDb, type Num } from "../../../src/lib/decimal";
import { DomainError } from "../../../src/lib/errors";
import { nowIso, newId, type Tx } from "../tx";
import { C, type Actor, type InvLot } from "../types";
import { audit, nextNumber } from "./core";
import { post } from "./inventory";
import { confirmOr } from "../soft";

export const MAX_COUNT_LINES = 120;

export interface StockCountInput {
  countId: string;
  note?: string | null;
  lines: Array<{ lotId: string; expected: Num; counted: Num }>;
}

export async function submitStockCount(tx: Tx, input: StockCountInput, actor: Actor) {
  const dupKey = `stockCount:${input.countId}`;
  const dup = await tx.get(C.uniq, dupKey);
  if (dup) return { count: await tx.must(C.stockCounts, dup.countDocId as string, "盤點紀錄"), duplicate: true };
  if (!input.lines.length) throw new DomainError("請至少輸入一個批次的實盤數量");
  if (input.lines.length > MAX_COUNT_LINES) throw new DomainError(`一次最多盤點 ${MAX_COUNT_LINES} 個批次，請分批送出`);
  if (new Set(input.lines.map((l) => l.lotId)).size !== input.lines.length) throw new DomainError("批次重複");

  const code = await nextNumber(tx, "SC");
  const groupId = newId();
  const lines = [];
  for (const l of input.lines) {
    const lot = await tx.must<InvLot>(C.lots, l.lotId, "庫存批次");
    const counted = D(l.counted);
    if (counted.isNegative()) throw new DomainError(`${lot.lotCode} 實盤數量不可為負`);
    if (lot.unit === "PCS" && !counted.isInteger()) throw new DomainError(`${lot.lotCode} 以件計，實盤數量需為整數`);
    if (!D(lot.onHand).eq(l.expected)) confirmOr(`${lot.lotCode} 在盤點期間有異動（目前帳面 ${D(lot.onHand)}，盤點時 ${D(l.expected)}）。仍要以實盤 ${counted} 為準嗎？`);
    if (counted.lt(lot.reserved)) confirmOr(`${lot.lotCode} 實盤 ${counted} 少於已保留 ${D(lot.reserved)}（訂單或分裝單已預留），之後那些訂單或分裝可能不夠。仍要送出嗎？`);
    const diff = counted.sub(lot.onHand);
    let txId: string | null = null;
    if (!diff.isZero()) {
      const t = await post(tx, { lotId: lot.id, type: "ADJUSTMENT", quantity: diff, refType: "StockCount", refId: code, groupId, note: `盤點 ${code}：帳面 ${D(lot.onHand)} → 實盤 ${counted}${input.note ? `（${input.note}）` : ""}`, actor });
      txId = t.id;
    }
    lines.push({ lotId: lot.id, lotCode: lot.lotCode, itemName: lot.itemName, kind: lot.kind, unit: lot.unit, expected: toDb(lot.onHand, 3), counted: toDb(counted, 3), diff: toDb(diff, 3), unitCost: lot.unitCost, valueDiff: toDb(diff.mul(lot.unitCost), 2), txId });
  }
  const changed = lines.filter((l) => !D(l.diff).isZero());
  const count = tx.create(C.stockCounts, {
    code,
    note: input.note ?? null,
    lineCount: lines.length,
    changedCount: changed.length,
    valueDiff: toDb(lines.reduce((s, l) => s.add(l.valueDiff), D(0)), 2),
    lines,
    actorId: actor.userId,
    actorName: actor.name ?? null,
    createdAt: nowIso(),
  });
  tx.set(C.uniq, dupKey, { kind: "stockCount", countDocId: count.id, at: nowIso() });
  audit(tx, actor, "inventory.count", "StockCount", count.id, `盤點 ${code}：${lines.length} 批，${changed.length} 批有差異，金額差 ${count.valueDiff}`);
  return { count, duplicate: false };
}
