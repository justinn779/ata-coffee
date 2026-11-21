import { CostCategory, CostTarget, InventoryTxType, type RoastEventType } from "@prisma/client";
import { lockLots, type Tx } from "@/lib/db";
import { D, toDb, type Num, percent, Decimal } from "@/lib/decimal";
import { DomainError, NotFoundError } from "@/lib/errors";
import { addDaysDateOnly } from "@/lib/time";
import { audit, type Actor } from "./audit";
import { createLot, ensureCoffeeItem, post } from "./inventory";
import { nextNumber } from "./sequence";

export interface RoastTimings {
  dryEndSec?: number | null; // 轉黃點
  firstCrackStartSec?: number | null;
  dropSec?: number | null; // 下豆時間（自入豆起算）
}

/**
 * 依實際輸入的事件時間計算各期。缺少必要事件時回傳 null，不做推估。
 *  脫水期 = 入豆 → 轉黃點；梅納期 = 轉黃點 → 一爆；發展期 = 一爆 → 下豆
 *  DTR = 發展期 ÷ 總烘焙時間 × 100%
 */
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

/** 失重率 = (投入生豆 − 出爐熟豆) ÷ 投入生豆 × 100% */
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

export interface CreateRoastInput {
  greenLotId: string;
  roasterId: string;
  roastedAt: Date;
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
  customFields?: Record<string, string> | null;
  extraCosts?: RoastExtraCost[];
  events?: Array<{ timeSec: number; type: RoastEventType; btC?: Num | null; etC?: Num | null; heat?: string | null; airflow?: string | null; drumSpeed?: string | null; note?: string | null }>;
}

const nn = (v: Num | null | undefined, dp: number) => (v == null || v === "" ? null : toDb(v, dp));

/**
 * 建立烘焙批次（單一 DB 交易）：
 *  1. 扣除生豆（烘焙領料）  2. 建立熟豆批次並入帳（烘焙產出）
 *  3. 熟豆每克成本 = (生豆成本 + 烘焙能源/人工等) ÷ 出爐熟豆重量
 */
export async function createRoastBatch(tx: Tx, input: CreateRoastInput, actor: Actor) {
  const green = await tx.greenBeanLot.findUnique({ where: { id: input.greenLotId }, include: { inventoryLot: true, coffee: true } });
  if (!green || !green.inventoryLot) throw new NotFoundError("生豆批次");
  const roaster = await tx.roasterProfile.findUnique({ where: { id: input.roasterId } });
  if (!roaster) throw new NotFoundError("烘豆機");
  if (roaster.maxCapacityG && D(input.greenWeightG).gt(roaster.maxCapacityG)) {
    throw new DomainError(`投入量超過 ${roaster.name} 最大容量 ${roaster.maxCapacityG}g`);
  }
  const loss = weightLoss(input.greenWeightG, input.roastedWeightG);
  const phases = computePhases(input);

  await lockLots(tx, [green.inventoryLot.id]);
  const greenLot = await tx.inventoryLot.findUniqueOrThrow({ where: { id: green.inventoryLot.id } });
  const greenCost = D(input.greenWeightG).mul(greenLot.unitCost);
  const extras = input.extraCosts ?? [];
  const extraTotal = extras.reduce((s, c) => s.add(c.amount), D(0));
  const roastedUnitCost = greenCost.add(extraTotal).div(input.roastedWeightG);

  const batchNo = await nextNumber(tx, "RB");
  const batch = await tx.roastBatch.create({
    data: {
      batchNo,
      greenLotId: green.id,
      roasterId: roaster.id,
      roastedAt: input.roastedAt,
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
      roastLevel: input.roastLevel,
      targetProfile: input.targetProfile,
      result: input.result,
      qualityRating: input.qualityRating ?? null,
      note: input.note,
      restStartDays: input.restStartDays ?? null,
      peakFromDays: input.peakFromDays ?? null,
      peakToDays: input.peakToDays ?? null,
      shelfLifeDays: input.shelfLifeDays ?? null,
      copiedFromId: input.copiedFromId ?? null,
      customFields: input.customFields ?? undefined,
      greenCostTotal: toDb(greenCost, 2),
      events: input.events?.length
        ? {
            create: input.events.map((e) => ({
              timeSec: e.timeSec,
              type: e.type,
              btC: nn(e.btC, 1),
              etC: nn(e.etC, 1),
              heat: e.heat,
              airflow: e.airflow,
              drumSpeed: e.drumSpeed,
              note: e.note,
            })),
          }
        : undefined,
    },
  });

  for (const c of extras) {
    await tx.costEntry.create({
      data: {
        category: c.category as CostCategory,
        target: CostTarget.ROAST_BATCH,
        amount: toDb(c.amount, 2),
        isEstimate: c.isEstimate,
        occurredOn: addDaysDateOnly(input.roastedAt, 0),
        roastBatchId: batch.id,
        calcNote: c.calcNote,
      },
    });
  }

  const groupId = crypto.randomUUID();
  await post(tx, {
    lotId: greenLot.id,
    type: InventoryTxType.ROAST_ISSUE,
    quantity: D(input.greenWeightG).neg(),
    refType: "RoastBatch",
    refId: batch.id,
    groupId,
    actor,
    occurredAt: input.roastedAt,
    note: `烘焙 ${batchNo}`,
  });

  const roastedItem = await ensureCoffeeItem(tx, green.coffeeId, "ROASTED");
  const shelf = input.shelfLifeDays ?? green.coffee.shelfLifeDays;
  const roastedLot = await createLot(tx, {
    itemId: roastedItem.id,
    lotCode: batchNo,
    unitCost: roastedUnitCost,
    roastBatchId: batch.id,
    producedAt: input.roastedAt,
    expiryDate: shelf != null ? addDaysDateOnly(input.roastedAt, shelf) : null,
    expirySource: shelf == null ? null : input.shelfLifeDays != null ? "烘焙批次覆寫保存期限" : "咖啡豆預設保存期限",
  });
  await post(tx, {
    lotId: roastedLot.id,
    type: InventoryTxType.ROAST_OUTPUT,
    quantity: input.roastedWeightG,
    refType: "RoastBatch",
    refId: batch.id,
    groupId,
    actor,
    occurredAt: input.roastedAt,
    note: `烘焙 ${batchNo}`,
  });

  await audit(tx, actor, "roast.create", "RoastBatch", batch.id, `烘焙 ${batchNo}：${input.greenWeightG}g → ${input.roastedWeightG}g（失重 ${loss}%）`);
  return { batch, roastedLot, roastedUnitCost: roastedUnitCost.toDecimalPlaces(6), weightLossPercent: loss, phases };
}

/** 熟豆賞味資訊（批次覆寫優先，否則使用咖啡豆預設） */
export function freshnessOf(
  batch: { roastedAt: Date; restStartDays: number | null; peakFromDays: number | null; peakToDays: number | null; shelfLifeDays: number | null },
  coffee: { restStartDays: number | null; peakFromDays: number | null; peakToDays: number | null; shelfLifeDays: number | null },
) {
  const pick = <K extends "restStartDays" | "peakFromDays" | "peakToDays" | "shelfLifeDays">(k: K) =>
    batch[k] != null ? { value: batch[k], source: "批次覆寫" } : coffee[k] != null ? { value: coffee[k], source: "咖啡豆預設" } : null;
  return { restStart: pick("restStartDays"), peakFrom: pick("peakFromDays"), peakTo: pick("peakToDays"), shelfLife: pick("shelfLifeDays") };
}
