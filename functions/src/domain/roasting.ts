import { D, toDb, type Num, percent, Decimal } from "../../../src/lib/decimal";
import { DomainError } from "../../../src/lib/errors";
import { addDaysYmd, restDays } from "../../../src/lib/time";
import { newId, nowIso, type Doc, type Tx } from "../tx";
import { confirmOr, warn } from "../soft";
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
  // 事件時間順序不對時只提醒，不計算該段（照樣存檔）
  const okM = maillard == null || maillard >= 0;
  const okD = development == null || development >= 0;
  if (!okM) warn("一爆時間早於轉黃點，梅納段沒有計算，請確認時間");
  if (!okD) warn("下豆時間早於一爆時間，發展段沒有計算，請確認時間");
  const dev = okD ? development : null;
  const dtr = dev != null && total ? percent(dev, total) : null;
  return { totalTimeSec: total, dryingPhaseSec: drying, maillardPhaseSec: okM ? maillard : null, developmentPhaseSec: dev, dtrPercent: dtr };
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
  /** 生豆批次（選填）；沒有生豆採購時改填 coffeeId，生豆成本以 0 計 */
  greenLotId?: string | null;
  coffeeId?: string | null;
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

/** 不影響庫存的紀錄欄位（新增與修改共用） */
function recordFields(input: CreateRoastInput, phases: ReturnType<typeof computePhases>) {
  return {
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
    events: (input.events ?? []).map((e) => ({ id: newId(), timeSec: e.timeSec, type: e.type, btC: nn(e.btC, 1), etC: nn(e.etC, 1), heat: e.heat ?? null, airflow: e.airflow ?? null, drumSpeed: e.drumSpeed ?? null, note: e.note ?? null })),
  };
}

/** 生豆批次（可沒有）與咖啡豆 */
async function roastSource(tx: Tx, input: CreateRoastInput) {
  const green = input.greenLotId ? await tx.must(C.greenLots, input.greenLotId, "生豆批次") : null;
  const coffeeId = (green?.coffeeId as string | undefined) ?? input.coffeeId;
  if (!coffeeId) throw new DomainError("請選擇生豆批次，或選擇咖啡豆（沒有生豆採購時）");
  const coffee = await tx.must(C.coffees, coffeeId, "咖啡豆");
  const greenLot = green?.invLotId ? await tx.get<InvLot>(C.lots, green.invLotId as string) : null;
  if (!green) warn("這批沒有對應的生豆採購，生豆成本以 0 計算、不扣生豆庫存；之後可以在烘焙紀錄補選生豆批次");
  return { green, coffee, greenLot };
}

function capacityWarn(roaster: Doc, greenWeightG: Num) {
  if (roaster.maxCapacityG && D(greenWeightG).gt(roaster.maxCapacityG as string)) warn(`投入量 ${greenWeightG}g 超過 ${roaster.name} 最大容量 ${roaster.maxCapacityG}g`);
}

export async function createRoastBatch(tx: Tx, input: CreateRoastInput, actor: Actor) {
  const { green, coffee, greenLot } = await roastSource(tx, input);
  const roaster = await tx.must(C.roasters, input.roasterId, "烘豆機");
  capacityWarn(roaster, input.greenWeightG);
  if (input.qualityRating != null && (input.qualityRating < 1 || input.qualityRating > 10)) throw new DomainError("品質評價需介於 1–10");
  const loss = weightLoss(input.greenWeightG, input.roastedWeightG);
  const phases = computePhases(input);
  const greenCost = greenLot ? D(input.greenWeightG).mul(greenLot.unitCost) : D(0);
  const extras = input.extraCosts ?? [];
  const extraTotal = extras.reduce((s, c) => s.add(c.amount), D(0));
  const roastedUnitCost = greenCost.add(extraTotal).div(input.roastedWeightG);

  const batchNo = await nextNumber(tx, "RB");
  const batch = tx.create(C.roastBatches, {
    batchNo,
    greenLotId: green?.id ?? null,
    greenLotCode: (green?.lotCode as string | undefined) ?? null,
    coffeeId: coffee.id,
    coffeeName: coffee.nameZh,
    roasterId: roaster.id,
    roasterName: roaster.name,
    roastedAt: input.roastedAt,
    status: "POSTED",
    greenWeightG: toDb(input.greenWeightG, 3),
    roastedWeightG: toDb(input.roastedWeightG, 3),
    weightLossPercent: toDb(loss, 3),
    ...recordFields(input, phases),
    copiedFromId: input.copiedFromId ?? null,
    greenCostTotal: toDb(greenCost, 2),
    invLotId: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  for (const c of extras) {
    tx.create(C.costs, { category: c.category, target: "ROAST_BATCH", amount: toDb(c.amount, 2), isEstimate: c.isEstimate, occurredOn: addDaysYmd(new Date(input.roastedAt), 0), roastBatchId: batch.id, productionOrderId: null, orderId: null, calcNote: c.calcNote ?? null, note: null, createdAt: nowIso() });
  }
  const groupId = newId();
  if (greenLot) await post(tx, { lotId: greenLot.id, type: "ROAST_ISSUE", quantity: D(input.greenWeightG).neg(), refType: "RoastBatch", refId: batch.id, groupId, actor, occurredAt: input.roastedAt, note: `烘焙 ${batchNo}` });
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

// ───────────── 修改／刪除烘焙批次 ─────────────

/** 熟豆批次上「非本次烘焙、也非杯測／試喝」的異動（分裝、出貨、報廢、盤點等）；有的話不能改重量或刪除 */
async function roastedLotUsage(tx: Tx, rb: Doc) {
  const lot = await tx.must<InvLot>(C.lots, rb.invLotId as string, "熟豆庫存批次");
  const txs = await tx.query(C.txs, [["lotId", "==", lot.id]]);
  // 依來源分組加總：已撤銷／沖銷而淨額為 0 的異動不算使用；杯測、試喝耗用不擋
  const net = new Map<string, { sum: Decimal; types: Set<string> }>();
  for (const t of txs) {
    if (t.refType === "RoastBatch" && t.refId === rb.id) continue;
    const key = t.reversesId ? `tx:${t.reversesId}` : t.refType === "MANUAL" ? `tx:${t.id}` : `${t.refType}:${t.refId}`;
    const g = net.get(key) ?? { sum: D(0), types: new Set<string>() };
    g.sum = g.sum.add(t.quantity as string);
    g.types.add(t.type as string);
    net.set(key, g);
  }
  const used = [...net.values()].some((g) => !g.sum.isZero() && ![...g.types].every((x) => x === "CUPPING_USE" || x === "TASTING_USE"));
  return { lot, used: used || D(lot.reserved).gt(0) };
}

/** 依烘焙日期重新計算杯測、手沖的「烘後天數」與批次顯示資訊 */
async function syncLabRecords(tx: Tx, rb: Doc) {
  for (const col of [C.cuppings, C.brews]) {
    const at = col === C.cuppings ? "cuppedAt" : "brewedAt";
    const what = col === C.cuppings ? "杯測" : "手沖";
    for (const s of await tx.query(col, [["roastBatchId", "==", rb.id]])) {
      if ((s[at] as string) < (rb.roastedAt as string)) warn(`烘焙時間晚於這批已有的${what}紀錄（${String(s[at]).slice(0, 16).replace("T", " ")}），請確認時間`);
      await tx.update(col, s.id, { batchNo: rb.batchNo, coffeeId: rb.coffeeId, coffeeName: rb.coffeeName, restDays: restDays(new Date(rb.roastedAt as string), new Date(s[at] as string)) });
    }
  }
}

/**
 * 修改烘焙批次：
 * - 時間、溫度、評價、事件、烘豆機等可隨時修改；杯測／手沖的烘後天數、熟豆到期日一併更新。
 * - 生豆批次、重量、成本變動時，以差額補扣／退回生豆並調整熟豆庫存與單位成本；
 *   熟豆已被分裝、出貨、保留或盤點調整時不可再改這些欄位。
 */
export async function updateRoastBatch(tx: Tx, id: string, input: CreateRoastInput, actor: Actor) {
  const cur = await tx.must(C.roastBatches, id, "烘焙批次");
  // 沒選生豆、也沒選咖啡豆時沿用原本的咖啡豆
  const green = input.greenLotId ? await tx.must(C.greenLots, input.greenLotId, "生豆批次") : null;
  const coffeeId = (green?.coffeeId as string | undefined) ?? input.coffeeId ?? (cur.coffeeId as string);
  const coffee = (await tx.get(C.coffees, coffeeId)) ?? { id: coffeeId, nameZh: cur.coffeeName, shelfLifeDays: null };
  const coffeeChanged = coffeeId !== cur.coffeeId;
  if (coffeeChanged) warn(`這批烘焙改成咖啡豆「${coffee.nameZh}」，熟豆庫存與這批的杯測、手沖紀錄一起改到新的咖啡豆`);
  const roaster = await tx.must(C.roasters, input.roasterId, "烘豆機");
  capacityWarn(roaster, input.greenWeightG);
  if (input.qualityRating != null && (input.qualityRating < 1 || input.qualityRating > 10)) throw new DomainError("品質評價需介於 1–10");
  const loss = weightLoss(input.greenWeightG, input.roastedWeightG);
  const phases = computePhases(input);
  const newGreenLot = green?.invLotId ? await tx.get<InvLot>(C.lots, green.invLotId as string) : null;
  const oldGreen = cur.greenLotId ? await tx.get(C.greenLots, cur.greenLotId as string) : null;
  const oldCosts = (await tx.query(C.costs, [["roastBatchId", "==", id]])).filter((c) => c.target === "ROAST_BATCH");
  const extras = input.extraCosts ?? [];
  const oldExtra = oldCosts.reduce((s, c) => s.add(c.amount as string), D(0));
  const newExtra = extras.reduce((s, c) => s.add(c.amount), D(0));
  const sameGreen = (green?.id ?? null) === ((cur.greenLotId as string | null) ?? null);
  const greenCost = sameGreen && D(input.greenWeightG).eq(cur.greenWeightG as string) ? D(cur.greenCostTotal as string) : newGreenLot ? D(input.greenWeightG).mul(newGreenLot.unitCost) : D(0);
  const invChanged = !sameGreen || !D(input.greenWeightG).eq(cur.greenWeightG as string) || !D(input.roastedWeightG).eq(cur.roastedWeightG as string) || !oldExtra.eq(newExtra);
  const { lot, used } = await roastedLotUsage(tx, cur);
  const batchNo = cur.batchNo as string;
  if (!green && !sameGreen) warn("這批改成沒有對應的生豆採購，生豆成本以 0 計算");
  if (invChanged) {
    if (used) confirmOr("這批熟豆已被分裝、出貨、保留或盤點調整過。改了生豆批次、重量或成本後，已經分裝或出貨的成本不會跟著變，熟豆庫存也可能變成負數。仍要修改嗎？");
    const groupId = newId();
    const note = `修改烘焙 ${batchNo}`;
    const base = { refType: "RoastBatch", refId: id, groupId, actor, occurredAt: input.roastedAt };
    if (sameGreen) {
      const diff = D(cur.greenWeightG as string).sub(input.greenWeightG);
      if (!diff.isZero() && newGreenLot) await post(tx, { ...base, lotId: newGreenLot.id, type: "ROAST_ISSUE", quantity: diff, note: `${note}：投入量 ${cur.greenWeightG}g → ${input.greenWeightG}g` });
    } else {
      const oldLot = oldGreen?.invLotId ? await tx.get<InvLot>(C.lots, oldGreen.invLotId as string) : null;
      if (oldLot && oldLot.status !== "SCRAPPED") await post(tx, { ...base, lotId: oldLot.id, type: "ROAST_ISSUE", quantity: cur.greenWeightG as string, note: `${note}：改用 ${green?.lotCode ?? "（無生豆採購）"}，退回原領料` });
      if (newGreenLot) await post(tx, { ...base, lotId: newGreenLot.id, type: "ROAST_ISSUE", quantity: D(input.greenWeightG).neg(), note: `${note}：由 ${oldGreen?.lotCode ?? cur.greenLotCode ?? "（無生豆採購）"} 改用此批` });
    }
    const rdiff = D(input.roastedWeightG).sub(cur.roastedWeightG as string);
    await tx.update(C.lots, lot.id, { unitCost: toDb(greenCost.add(newExtra).div(input.roastedWeightG), 6), updatedAt: nowIso() });
    if (!rdiff.isZero()) await post(tx, { ...base, lotId: lot.id, type: "ROAST_OUTPUT", quantity: rdiff, note: `${note}：出爐量 ${cur.roastedWeightG}g → ${input.roastedWeightG}g` });
  }
  for (const c of oldCosts) await tx.delete(C.costs, c.id);
  for (const c of extras) tx.create(C.costs, { category: c.category, target: "ROAST_BATCH", amount: toDb(c.amount, 2), isEstimate: c.isEstimate, occurredOn: addDaysYmd(new Date(input.roastedAt), 0), roastBatchId: id, productionOrderId: null, orderId: null, calcNote: c.calcNote ?? null, note: null, createdAt: nowIso() });
  const shelf = input.shelfLifeDays ?? (coffee.shelfLifeDays as number | null);
  if (coffeeChanged) {
    const item = await ensureCoffeeItem(tx, coffeeId, "ROASTED");
    await tx.update(C.lots, lot.id, { itemId: item.id, itemName: item.name, coffeeId });
  }
  await tx.update(C.lots, lot.id, {
    producedAt: input.roastedAt,
    expiryDate: shelf != null ? addDaysYmd(new Date(input.roastedAt), shelf) : null,
    expirySource: shelf == null ? null : input.shelfLifeDays != null ? "烘焙批次覆寫保存期限" : "咖啡豆預設保存期限",
  });
  const next = await tx.update(C.roastBatches, id, {
    greenLotId: green?.id ?? null,
    greenLotCode: green ? (green.lotCode as string) : sameGreen ? ((cur.greenLotCode as string | null) ?? null) : null,
    greenLotDeleted: green ? false : sameGreen ? (cur.greenLotDeleted ?? false) : false,
    coffeeId,
    coffeeName: coffee.nameZh,
    roasterId: roaster.id,
    roasterName: roaster.name,
    roastedAt: input.roastedAt,
    greenWeightG: toDb(input.greenWeightG, 3),
    roastedWeightG: toDb(input.roastedWeightG, 3),
    weightLossPercent: toDb(loss, 3),
    greenCostTotal: toDb(greenCost, 2),
    ...recordFields(input, phases),
    updatedAt: nowIso(),
  });
  await syncLabRecords(tx, next);
  audit(tx, actor, "roast.update", "RoastBatch", id, `修改烘焙 ${batchNo}${invChanged ? `：${input.greenWeightG}g → ${input.roastedWeightG}g（已調整庫存）` : ""}`);
}

/**
 * 刪除烘焙批次：先提醒有哪些紀錄用到它，確認後只刪這筆烘焙；杯測、手沖保留原本的批號與烘焙日期，標示「烘焙紀錄已刪除」。
 * - 熟豆還沒被分裝、出貨等使用：退回生豆、扣回熟豆（跟原本一樣）。
 * - 熟豆已被使用：庫存維持現狀（熟豆批次與帳本保留），只刪除烘焙紀錄。
 */
export async function deleteRoastBatch(tx: Tx, id: string, actor: Actor) {
  const cur = await tx.must(C.roastBatches, id, "烘焙批次");
  const cups = await tx.query(C.cuppings, [["roastBatchId", "==", id]]);
  const brews = await tx.query(C.brews, [["roastBatchId", "==", id]]);
  const { lot, used } = await roastedLotUsage(tx, cur);
  const notes = [cups.length ? `${cups.length} 筆杯測` : "", brews.length ? `${brews.length} 筆手沖` : ""].filter(Boolean);
  const msgs = [notes.length ? `這批還有 ${notes.join("、")}紀錄（會保留，標示烘焙紀錄已刪除）` : "", used ? "熟豆已被分裝、出貨、保留或盤點調整，刪除後熟豆庫存維持現狀、不退回生豆" : ""].filter(Boolean);
  if (msgs.length) confirmOr(`${msgs.join("；")}。確定刪除烘焙批次 ${cur.batchNo} 嗎？`);
  for (const [col, list] of [[C.cuppings, cups], [C.brews, brews]] as const) {
    for (const s of list) await tx.update(col, s.id, { roastBatchId: null, roastDeleted: true, sampleRoastedDate: String(cur.roastedAt).slice(0, 10), updatedAt: nowIso() });
  }
  const groupId = newId();
  const note = `刪除烘焙 ${cur.batchNo}`;
  if (!used) {
    const green = cur.greenLotId ? await tx.get(C.greenLots, cur.greenLotId as string) : null;
    const greenLot = green?.invLotId ? await tx.get<InvLot>(C.lots, green.invLotId as string) : null;
    if (D(lot.onHand).gt(0)) await post(tx, { lotId: lot.id, type: "ROAST_OUTPUT", quantity: D(lot.onHand).neg(), refType: "RoastBatch", refId: id, groupId, actor, note });
    if (greenLot && greenLot.status !== "SCRAPPED") await post(tx, { lotId: greenLot.id, type: "ROAST_ISSUE", quantity: cur.greenWeightG as string, refType: "RoastBatch", refId: id, groupId, actor, note: `${note}：退回生豆` });
    await tx.update(C.lots, lot.id, { status: "SCRAPPED", note: `${note}（批次已刪除）`, updatedAt: nowIso() });
  } else {
    await tx.update(C.lots, lot.id, { note: `烘焙紀錄 ${cur.batchNo} 已刪除`, updatedAt: nowIso() });
  }
  for (const c of await tx.query(C.costs, [["roastBatchId", "==", id]])) await tx.delete(C.costs, c.id);
  for (const c of await tx.query(C.roastCurves, [["roastBatchId", "==", id]])) {
    for (let i = 0; i < ((c.chunkCount as number) ?? 0); i++) await tx.delete(`${C.roastCurves}/${c.id}/chunks`, String(i));
    await tx.delete(C.roastCurves, c.id);
  }
  await tx.delete(C.roastBatches, id);
  audit(tx, actor, "roast.delete", "RoastBatch", id, `${note}（${cur.coffeeName}，${cur.greenWeightG}g → ${cur.roastedWeightG}g），已退回生豆`);
}

/** 生豆成本更正後重算烘焙成本；熟豆已分裝、出貨或保留時保留原成本（已進入下游成本），回傳是否有重算 */
export async function recostRoastBatch(tx: Tx, rb: Doc, greenUnitCost: Decimal | string) {
  const { lot, used } = await roastedLotUsage(tx, rb);
  if (used) return false;
  const greenCost = D(rb.greenWeightG as string).mul(greenUnitCost);
  const extras = (await tx.query(C.costs, [["roastBatchId", "==", rb.id]])).filter((c) => c.target === "ROAST_BATCH").reduce((s, c) => s.add(c.amount as string), D(0));
  await tx.update(C.roastBatches, rb.id, { greenCostTotal: toDb(greenCost, 2), updatedAt: nowIso() });
  await tx.update(C.lots, lot.id, { unitCost: toDb(greenCost.add(extras).div(rb.roastedWeightG as string), 6), updatedAt: nowIso() });
  return true;
}
