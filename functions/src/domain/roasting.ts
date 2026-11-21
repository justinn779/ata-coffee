import { D, toDb, type Num, percent, Decimal } from "../../../src/lib/decimal";
import { DomainError } from "../../../src/lib/errors";
import { addDaysYmd } from "../../../src/lib/time";
import { newId, nowIso, type Tx } from "../tx";
import { C, type Actor, type InvLot } from "../types";
import { audit, nextNumber } from "./core";
import { createLot, ensureCoffeeItem, post } from "./inventory";

export interface RoastTimings {
  dryEndSec?: number | null;
  firstCrackStartSec?: number | null;
  dropSec?: number | null;
}

/** 依實際輸入的事件時間計算各期；缺少事件時回傳 null，不推估 */
export function computePhases(t: RoastTimings) {
  const total = t.dropSec ?? null;
  const drying = t.dryEndSec ?? null;
  const maillard = t.dryEndSec != null && t.firstCrackStartSec != null ? t.firstCrackStartSec - t.dryEndSec : null;
  const development = t.firstCrackStartSec != null && t.dropSec != null ? t.dropSec - t.firstCrackStartSec : null;
  if (maillard != null && maillard < 0) throw new DomainError("一爆時間不可早於轉黃點");
  if (development != null && development < 0) throw new DomainError("下豆時間不可早於一爆時間");
  const dtr = development != null && total ? percent(development, total) : null;
  return { totalTimeSec: total, dryingPhaseSec: drying, maillardPhaseSec: maillard, developmentPhaseSec: development, dtrPercent: dtr };
}

/** 失重率 = (投入 − 產出) ÷ 投入 × 100% */
export function weightLoss(greenG: Num, roastedG: Num): Decimal {
  const g = D(greenG);
  const r = D(roastedG);
  if (g.lte(0) || r.lte(0)) throw new DomainError("生豆與熟豆重量必須大於 0");
  if (r.gt(g)) throw new DomainError("出爐熟豆重量不可大於投入生豆重量");
  return percent(g.sub(r), g)!;
}

export interface RoastExtraCost {
  category: "ROAST_ENERGY" | "ROAST_LABOR" | "CONSUMABLES";
  amount: Num;
  isEstimate: boolean;
  calcNote?: string | null;
}

export interface RoastEventInput {
  timeSec: number;
  type: string;
  btC?: Num | null;
  etC?: Num | null;
  heat?: string | null;
  airflow?: string | null;
  drumSpeed?: string | null;
  note?: string | null;
}

export interface CreateRoastInput {
  greenLotId: string;
  roasterId: string;
  roastedAt: string;
  greenWeightG: Num;
  roastedWeightG: Num;
  chargeTempC?: Num | null;
  turningPointSec?: number | null;
  turningPointTempC?: Num | null;
  dryEndSec?: number | null;
  firstCrackStartSec?: number | null;
  firstCrackEndSec?: number | null;
  dropSec?: number | null;
  dropTempC?: Num | null;
  roastLevel?: string | null;
  targetProfile?: string | null;
  result?: string | null;
  qualityRating?: number | null;
  note?: string | null;
  restStartDays?: number | null;
  peakFromDays?: number | null;
  peakToDays?: number | null;
  shelfLifeDays?: number | null;
  copiedFromId?: string | null;
  extraCosts?: RoastExtraCost[];
  events?: RoastEventInput[];
}

const nn = (v: Num | null | undefined, dp: number) => (v == null || v === "" ? null : toDb(v, dp));

export async function createRoastBatch(tx: Tx, input: CreateRoastInput, actor: Actor) {
  const green = await tx.must(C.greenLots, input.greenLotId, "生豆批次");
  const coffee = await tx.must(C.coffees, green.coffeeId as string, "咖啡豆");
  const roaster = await tx.must(C.roasters, input.roasterId, "烘豆機");
  if (roaster.maxCapacityG && D(input.greenWeightG).gt(roaster.maxCapacityG as string)) throw new DomainError(`投入量超過 ${roaster.name} 最大容量 ${roaster.maxCapacityG}g`);
  if (input.qualityRating != null && (input.qualityRating < 1 || input.qualityRating > 10)) throw new DomainError("品質評價需介於 1–10");
  const loss = weightLoss(input.greenWeightG, input.roastedWeightG);
  const phases = computePhases(input);
  const greenLot = await tx.must<InvLot>(C.lots, green.invLotId as string, "生豆庫存批次");
  const greenCost = D(input.greenWeightG).mul(greenLot.unitCost);
  const extras = input.extraCosts ?? [];
  const extraTotal = extras.reduce((s, c) => s.add(c.amount), D(0));
  const roastedUnitCost = greenCost.add(extraTotal).div(input.roastedWeightG);

  const batchNo = await nextNumber(tx, "RB");
  const batch = tx.create(C.roastBatches, {
    batchNo,
    greenLotId: green.id,
    greenLotCode: green.lotCode,
    coffeeId: coffee.id,
    coffeeName: coffee.nameZh,
    roasterId: roaster.id,
    roasterName: roaster.name,
    roastedAt: input.roastedAt,
    status: "POSTED",
    greenWeightG: toDb(input.greenWeightG, 3),
    roastedWeightG: toDb(input.roastedWeightG, 3),
    weightLossPercent: toDb(loss, 3),
    chargeTempC: nn(input.chargeTempC, 1),
    turningPointSec: input.turningPointSec ?? null,
    turningPointTempC: nn(input.turningPointTempC, 1),
    dryEndSec: input.dryEndSec ?? null,
    firstCrackStartSec: input.firstCrackStartSec ?? null,
    firstCrackEndSec: input.firstCrackEndSec ?? null,
    dropSec: input.dropSec ?? null,
    dropTempC: nn(input.dropTempC, 1),
    totalTimeSec: phases.totalTimeSec,
    dryingPhaseSec: phases.dryingPhaseSec,
    maillardPhaseSec: phases.maillardPhaseSec,
    developmentPhaseSec: phases.developmentPhaseSec,
    dtrPercent: phases.dtrPercent ? toDb(phases.dtrPercent, 3) : null,
    roastLevel: input.roastLevel ?? null,
    targetProfile: input.targetProfile ?? null,
    result: input.result ?? null,
    qualityRating: input.qualityRating ?? null,
    note: input.note ?? null,
    restStartDays: input.restStartDays ?? null,
    peakFromDays: input.peakFromDays ?? null,
    peakToDays: input.peakToDays ?? null,
    shelfLifeDays: input.shelfLifeDays ?? null,
    copiedFromId: input.copiedFromId ?? null,
    greenCostTotal: toDb(greenCost, 2),
    events: (input.events ?? []).map((e) => ({ id: newId(), timeSec: e.timeSec, type: e.type, btC: nn(e.btC, 1), etC: nn(e.etC, 1), heat: e.heat ?? null, airflow: e.airflow ?? null, drumSpeed: e.drumSpeed ?? null, note: e.note ?? null })),
    invLotId: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  for (const c of extras) {
    tx.create(C.costs, { category: c.category, target: "ROAST_BATCH", amount: toDb(c.amount, 2), isEstimate: c.isEstimate, occurredOn: addDaysYmd(new Date(input.roastedAt), 0), roastBatchId: batch.id, productionOrderId: null, orderId: null, calcNote: c.calcNote ?? null, note: null, createdAt: nowIso() });
  }
  const groupId = newId();
  await post(tx, { lotId: greenLot.id, type: "ROAST_ISSUE", quantity: D(input.greenWeightG).neg(), refType: "RoastBatch", refId: batch.id, groupId, actor, occurredAt: input.roastedAt, note: `烘焙 ${batchNo}` });
  const roastedItem = await ensureCoffeeItem(tx, coffee.id, "ROASTED");
  const shelf = input.shelfLifeDays ?? (coffee.shelfLifeDays as number | null);
  const roastedLot = await createLot(tx, {
    itemId: roastedItem.id,
    lotCode: batchNo,
    unitCost: roastedUnitCost,
    roastBatchId: batch.id,
    producedAt: input.roastedAt,
    coffeeId: coffee.id,
    expiryDate: shelf != null ? addDaysYmd(new Date(input.roastedAt), shelf) : null,
    expirySource: shelf == null ? null : input.shelfLifeDays != null ? "烘焙批次覆寫保存期限" : "咖啡豆預設保存期限",
  });
  await tx.update(C.roastBatches, batch.id, { invLotId: roastedLot.id });
  await post(tx, { lotId: roastedLot.id, type: "ROAST_OUTPUT", quantity: input.roastedWeightG, refType: "RoastBatch", refId: batch.id, groupId, actor, occurredAt: input.roastedAt, note: `烘焙 ${batchNo}` });
  audit(tx, actor, "roast.create", "RoastBatch", batch.id, `烘焙 ${batchNo}：${input.greenWeightG}g → ${input.roastedWeightG}g（失重 ${loss}%）`);
  return { batch: { ...batch, invLotId: roastedLot.id }, roastedLot, roastedUnitCost: roastedUnitCost.toDecimalPlaces(6), weightLossPercent: loss, phases };
}

export { freshnessOf } from "../../../src/lib/freshness";
