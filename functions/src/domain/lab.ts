import { D, toDb, type Num } from "../../../src/lib/decimal";
import { DomainError } from "../../../src/lib/errors";
import { restDays } from "../../../src/lib/time";
import { nowIso, type Doc, type Tx } from "../tx";
import { C, type Actor } from "../types";
import { audit } from "./core";
import { manualAdjust, reverseTransaction } from "./inventory";

export async function upsertTags(tx: Tx, raw: string | null | undefined) {
  const names = [...new Set((raw ?? "").split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean))].slice(0, 20);
  for (const name of names) {
    const id = `tag-${Buffer.from(name).toString("hex").slice(0, 60)}`;
    if (!(await tx.get(C.flavorTags, id))) tx.set(C.flavorTags, id, { name, category: null, createdAt: nowIso() });
  }
  return names;
}

const nn = (v: Num | null | undefined, dp: number) => (v == null || v === "" ? null : toDb(v, dp));

/**
 * 研發紀錄的扣庫存：每筆紀錄最多對應一筆手動耗用交易（stockTxId）。
 * 修改數量或取消扣庫存時，沖銷舊交易（帳本只新增不修改）再依新數量扣除。
 */
async function syncStock(tx: Tx, rec: Doc | null, o: { lotId: string; type: "CUPPING_USE" | "TASTING_USE"; qty: Num | null | undefined; note: string; actor: Actor }) {
  const want = o.qty != null && o.qty !== "" && D(o.qty).gt(0) ? D(o.qty) : null;
  let curId = (rec?.stockTxId as string | null | undefined) ?? null;
  if (rec && rec.stockTxId === undefined) {
    // 舊資料（未記錄 stockTxId）：以批次＋類型＋備註找回當初的扣庫存交易
    const hits = await tx.query(C.txs, [["lotId", "==", o.lotId], ["type", "==", o.type], ["note", "==", o.note]]);
    curId = hits[0]?.id ?? null;
  }
  const cur = curId ? await tx.get(C.txs, curId) : null;
  const active = cur && !(await tx.get("invTxReversals", cur.id)) ? cur : null;
  if (active && want && D(active.quantity as string).neg().eq(want)) return active.id;
  if (active) await reverseTransaction(tx, active.id, o.actor, `${o.note} 修改／刪除，沖銷原扣庫存`);
  if (!want) return null;
  return (await manualAdjust(tx, { lotId: o.lotId, type: o.type, quantity: want.neg(), actor: o.actor, note: o.note })).id;
}

export interface CuppingInput {
  roastBatchId: string;
  templateId: string;
  cuppedAt: string;
  grindSetting?: string | null;
  doseG?: Num | null;
  waterG?: Num | null;
  waterTempC?: Num | null;
  scores: Record<string, Num | null>;
  tags?: string | null;
  defects?: string | null;
  description?: string | null;
  evaluator?: string | null;
  consumedG?: Num | null;
  deductStock?: boolean;
}

async function cuppingFields(tx: Tx, rb: Doc, i: CuppingInput) {
  const tpl = await tx.must(C.cuppingTemplates, i.templateId, "評分模板");
  if (i.cuppedAt < (rb.roastedAt as string)) throw new DomainError("杯測時間不可早於烘焙時間");
  const attrs = tpl.attributes as Array<{ key: string; label: string }>;
  const scores = attrs
    .filter((a) => i.scores[a.key] != null && i.scores[a.key] !== "")
    .map((a) => {
      const v = D(i.scores[a.key]!);
      if (v.lt(tpl.scaleMin as string) || v.gt(tpl.scaleMax as string)) throw new DomainError(`${a.label} 分數需介於 ${tpl.scaleMin}–${tpl.scaleMax}`);
      return { attributeKey: a.key, label: a.label, score: toDb(v, 2) };
    });
  const total = scores.length ? scores.reduce((s, x) => s.add(x.score), D(0)).div(scores.length) : null;
  const tags = await upsertTags(tx, i.tags);
  return {
    roastBatchId: rb.id,
    batchNo: rb.batchNo,
    coffeeId: rb.coffeeId,
    coffeeName: rb.coffeeName,
    templateId: tpl.id,
    templateName: tpl.name,
    cuppedAt: i.cuppedAt,
    restDays: restDays(new Date(rb.roastedAt as string), new Date(i.cuppedAt)),
    grindSetting: i.grindSetting ?? null,
    doseG: nn(i.doseG, 2),
    waterG: nn(i.waterG, 2),
    waterTempC: nn(i.waterTempC, 1),
    totalScore: total ? toDb(total, 2) : null,
    scores,
    tags,
    defects: i.defects ?? null,
    description: i.description ?? null,
    evaluator: i.evaluator ?? null,
    consumedG: nn(i.consumedG, 3),
  };
}

export async function createCupping(tx: Tx, i: CuppingInput, actor: Actor) {
  const rb = await tx.must(C.roastBatches, i.roastBatchId, "烘焙批次");
  const fields = await cuppingFields(tx, rb, i);
  const s = tx.create(C.cuppings, { ...fields, stockTxId: null as string | null, createdAt: nowIso() });
  if (i.deductStock) {
    s.stockTxId = await syncStock(tx, null, { lotId: rb.invLotId as string, type: "CUPPING_USE", qty: i.consumedG, note: `杯測 ${s.id.slice(0, 8)}`, actor });
    tx.set(C.cuppings, s.id, s);
  }
  audit(tx, actor, "cupping.create", "CuppingSession", s.id, `杯測 ${rb.batchNo}（烘後 ${s.restDays} 天）`);
  return s;
}

/** 修改杯測：烘焙批次不可變更；扣庫存數量變動時自動沖銷並重扣 */
export async function updateCupping(tx: Tx, id: string, i: Omit<CuppingInput, "roastBatchId">, actor: Actor) {
  const cur = await tx.must(C.cuppings, id, "杯測紀錄");
  const rb = await tx.must(C.roastBatches, cur.roastBatchId as string, "烘焙批次");
  const fields = await cuppingFields(tx, rb, { ...i, roastBatchId: rb.id });
  const stockTxId = await syncStock(tx, cur, { lotId: rb.invLotId as string, type: "CUPPING_USE", qty: i.deductStock ? i.consumedG : null, note: `杯測 ${id.slice(0, 8)}`, actor });
  tx.set(C.cuppings, id, { ...cur, ...fields, stockTxId, updatedAt: nowIso() });
  audit(tx, actor, "cupping.update", "CuppingSession", id, `修改杯測 ${rb.batchNo}`);
}

/** 刪除杯測：若曾扣庫存，自動沖銷回庫存 */
export async function deleteCupping(tx: Tx, id: string, actor: Actor) {
  const cur = await tx.must(C.cuppings, id, "杯測紀錄");
  const rb = await tx.get(C.roastBatches, cur.roastBatchId as string);
  if (rb) await syncStock(tx, cur, { lotId: rb.invLotId as string, type: "CUPPING_USE", qty: null, note: `杯測 ${id.slice(0, 8)}`, actor });
  await tx.delete(C.cuppings, id);
  audit(tx, actor, "cupping.delete", "CuppingSession", id, `刪除杯測 ${cur.batchNo}（${String(cur.cuppedAt).slice(0, 10)}）`);
}

export interface BrewInput {
  roastBatchId: string;
  recipeId?: string | null;
  brewedAt: string;
  grinderId?: string | null;
  grindSetting?: string | null;
  dripperId?: string | null;
  filterId?: string | null;
  doseG: Num;
  waterG: Num;
  waterTempC?: Num | null;
  waterQuality?: string | null;
  tdsPercent?: Num | null;
  extractionPercent?: Num | null;
  totalTimeSec?: number | null;
  bloomTimeSec?: number | null;
  bloomWaterG?: Num | null;
  pourMethod?: string | null;
  flowRateGPerSec?: Num | null;
  agitation?: string | null;
  flavorNotes?: string | null;
  tags?: string | null;
  rating?: Num | null;
  note?: string | null;
  isRecommended?: boolean;
  pourSteps: Array<{ startSec?: number | null; endSec?: number | null; waterG: Num; note?: string | null }>;
  deductStock?: boolean;
}

async function brewFields(tx: Tx, rb: Doc, i: BrewInput) {
  if (i.brewedAt < (rb.roastedAt as string)) throw new DomainError("沖煮時間不可早於烘焙時間");
  const dose = D(i.doseG);
  if (dose.lte(0)) throw new DomainError("粉量必須大於 0");
  let cum = D(0);
  const steps = i.pourSteps.map((s, idx) => {
    cum = cum.add(s.waterG);
    if (s.startSec != null && s.endSec != null && s.endSec < s.startSec) throw new DomainError(`第 ${idx + 1} 段結束時間早於起始時間`);
    return { stepNo: idx + 1, startSec: s.startSec ?? null, endSec: s.endSec ?? null, waterG: toDb(s.waterG, 2), cumulativeG: toDb(cum, 2), note: s.note ?? null };
  });
  if (steps.length && !cum.eq(i.waterG)) throw new DomainError(`分段注水合計 ${cum}g 與總水量 ${i.waterG}g 不一致`);
  const name = async (id?: string | null) => (id ? ((await tx.get(C.equipment, id))?.name as string) ?? null : null);
  const recipe = i.recipeId ? await tx.get(C.brewRecipes, i.recipeId) : null;
  const tags = await upsertTags(tx, i.tags);
  return {
    roastBatchId: rb.id,
    batchNo: rb.batchNo,
    coffeeId: rb.coffeeId,
    coffeeName: rb.coffeeName,
    recipeId: i.recipeId ?? null,
    recipeLabel: recipe ? `${recipe.name} v${recipe.version}` : null,
    brewedAt: i.brewedAt,
    restDays: restDays(new Date(rb.roastedAt as string), new Date(i.brewedAt)),
    grinderId: i.grinderId ?? null,
    grinderName: await name(i.grinderId),
    grindSetting: i.grindSetting ?? null,
    dripperId: i.dripperId ?? null,
    dripperName: await name(i.dripperId),
    filterId: i.filterId ?? null,
    filterName: await name(i.filterId),
    doseG: toDb(dose, 2),
    waterG: toDb(i.waterG, 2),
    ratio: toDb(D(i.waterG).div(dose), 2),
    waterTempC: nn(i.waterTempC, 1),
    waterQuality: i.waterQuality ?? null,
    tdsPercent: nn(i.tdsPercent, 2),
    extractionPercent: nn(i.extractionPercent, 2),
    totalTimeSec: i.totalTimeSec ?? null,
    bloomTimeSec: i.bloomTimeSec ?? null,
    bloomWaterG: nn(i.bloomWaterG, 2),
    pourMethod: i.pourMethod ?? null,
    flowRateGPerSec: nn(i.flowRateGPerSec, 2),
    agitation: i.agitation ?? null,
    flavorNotes: i.flavorNotes ?? null,
    tags,
    rating: nn(i.rating, 1),
    note: i.note ?? null,
    isRecommended: i.isRecommended ?? false,
    pourSteps: steps,
  };
}

export async function createBrew(tx: Tx, i: BrewInput, actor: Actor) {
  const rb = await tx.must(C.roastBatches, i.roastBatchId, "烘焙批次");
  const fields = await brewFields(tx, rb, i);
  const s = tx.create(C.brews, { ...fields, stockTxId: null as string | null, createdAt: nowIso() });
  if (i.deductStock) {
    s.stockTxId = await syncStock(tx, null, { lotId: rb.invLotId as string, type: "TASTING_USE", qty: i.doseG, note: `手沖試喝 ${s.id.slice(0, 8)}`, actor });
    tx.set(C.brews, s.id, s);
  }
  audit(tx, actor, "brew.create", "BrewSession", s.id, `手沖 ${rb.batchNo}（烘後 ${s.restDays} 天）`);
  return s;
}

/** 修改手沖：烘焙批次不可變更；有扣庫存時以新粉量沖銷重扣 */
export async function updateBrew(tx: Tx, id: string, i: Omit<BrewInput, "roastBatchId">, actor: Actor) {
  const cur = await tx.must(C.brews, id, "沖煮紀錄");
  const rb = await tx.must(C.roastBatches, cur.roastBatchId as string, "烘焙批次");
  const fields = await brewFields(tx, rb, { ...i, roastBatchId: rb.id });
  const stockTxId = await syncStock(tx, cur, { lotId: rb.invLotId as string, type: "TASTING_USE", qty: i.deductStock ? i.doseG : null, note: `手沖試喝 ${id.slice(0, 8)}`, actor });
  tx.set(C.brews, id, { ...cur, ...fields, stockTxId, updatedAt: nowIso() });
  audit(tx, actor, "brew.update", "BrewSession", id, `修改手沖 ${rb.batchNo}`);
}

/** 刪除手沖：若曾扣庫存，自動沖銷回庫存 */
export async function deleteBrew(tx: Tx, id: string, actor: Actor) {
  const cur = await tx.must(C.brews, id, "沖煮紀錄");
  const rb = await tx.get(C.roastBatches, cur.roastBatchId as string);
  if (rb) await syncStock(tx, cur, { lotId: rb.invLotId as string, type: "TASTING_USE", qty: null, note: `手沖試喝 ${id.slice(0, 8)}`, actor });
  await tx.delete(C.brews, id);
  audit(tx, actor, "brew.delete", "BrewSession", id, `刪除手沖 ${cur.batchNo}（${String(cur.brewedAt).slice(0, 10)}）`);
}

export async function saveRecipeFromBrew(tx: Tx, brewId: string, name: string, actor: Actor) {
  const b = await tx.must(C.brews, brewId, "沖煮紀錄");
  const same = await tx.query(C.brewRecipes, [["name", "==", name]]);
  const version = same.reduce((m, r) => Math.max(m, r.version as number), 0) + 1;
  const rootId = same.find((r) => r.version === 1)?.id ?? null;
  const r = tx.create(C.brewRecipes, {
    name,
    rootId,
    version,
    coffeeId: b.coffeeId,
    coffeeName: b.coffeeName,
    isRecommended: false,
    grinderId: b.grinderId,
    grinderName: b.grinderName,
    grindSetting: b.grindSetting,
    dripperId: b.dripperId,
    dripperName: b.dripperName,
    filterId: b.filterId,
    filterName: b.filterName,
    doseG: b.doseG,
    waterG: b.waterG,
    waterTempC: b.waterTempC,
    bloomWaterG: b.bloomWaterG,
    bloomTimeSec: b.bloomTimeSec,
    totalTimeSec: b.totalTimeSec,
    pourMethod: b.pourMethod,
    agitation: b.agitation,
    pourPlan: (b.pourSteps as Array<Record<string, unknown>>).map((s) => ({ stepNo: s.stepNo, startSec: s.startSec, endSec: s.endSec, waterG: s.waterG })),
    note: `由沖煮紀錄 ${b.id.slice(0, 8)} 建立`,
    createdAt: nowIso(),
  });
  audit(tx, actor, "recipe.create", "BrewRecipe", r.id, `配方 ${name} v${version}`);
  return r;
}
