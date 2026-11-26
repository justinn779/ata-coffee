import { D, toDb, type Num } from "../../../src/lib/decimal";
import { DomainError } from "../../../src/lib/errors";
import { restDays } from "../../../src/lib/time";
import { nowIso, type Doc, type Tx } from "../tx";
import { warn } from "../soft";
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
  if (active && want && active.lotId === o.lotId && D(active.quantity as string).neg().eq(want)) return active.id;
  if (active) await reverseTransaction(tx, active.id, o.actor, `${o.note} 修改／刪除，沖銷原扣庫存`);
  if (!want) return null;
  return (await manualAdjust(tx, { lotId: o.lotId, type: o.type, quantity: want.neg(), actor: o.actor, note: o.note })).id;
}

/**
 * 杯測／手沖的豆子來源：通常是自家烘焙批次；也可以不經過烘豆紀錄，直接記在咖啡豆上
 * （例如供應商樣品、外購熟豆），此時可填烘焙日期以計算烘後天數，且不扣庫存。
 */
export interface BeanSource {
  roastBatchId?: string | null;
  coffeeId?: string | null;
  roastedDate?: string | null;
}
type Source = { rb: Doc | null; coffeeId: string; coffeeName: string; batchNo: string; roastedAt: string | null };

/**
 * 修改時可以改選來源：有傳 roastBatchId 或 coffeeId 就用新的，否則沿用原本的。
 * 原本的烘焙紀錄已刪除（roastDeleted）時保留原批號；咖啡豆已刪除時沿用原名稱。
 */
async function beanSource(tx: Tx, i: BeanSource, cur?: Doc | null): Promise<Source> {
  const given = i.roastBatchId !== undefined || i.coffeeId !== undefined;
  const keep = !!cur && !given;
  const changed = !!cur && given && ((i.roastBatchId ?? null) !== ((cur.roastBatchId as string | null) ?? null) || (!i.roastBatchId && i.coffeeId != null && i.coffeeId !== cur.coffeeId));
  const rbId = keep ? ((cur!.roastBatchId as string | null) ?? null) : (i.roastBatchId ?? null);
  if (rbId) {
    const rb = await tx.must(C.roastBatches, rbId, "烘焙批次");
    return { rb, coffeeId: rb.coffeeId as string, coffeeName: rb.coffeeName as string, batchNo: rb.batchNo as string, roastedAt: rb.roastedAt as string };
  }
  const coffeeId = (keep ? undefined : i.coffeeId) ?? (cur?.coffeeId as string | undefined);
  if (!coffeeId) throw new DomainError("請選擇烘焙批次，或選擇咖啡豆（沒有烘豆紀錄時）");
  const c = await tx.get(C.coffees, coffeeId);
  if (!c && (!cur || coffeeId !== cur.coffeeId)) throw new DomainError("找不到咖啡豆", "NOT_FOUND", 404);
  const keepNo = cur && !changed && cur.roastDeleted ? (cur.batchNo as string) : "樣品";
  return { rb: null, coffeeId, coffeeName: (c?.nameZh as string) ?? (cur?.coffeeName as string), batchNo: keepNo, roastedAt: i.roastedDate ? `${i.roastedDate}T00:00:00+08:00` : null };
}

function timeWarn(what: string, at: string, roastedAt: string | null) {
  if (roastedAt && new Date(at) < new Date(roastedAt)) warn(`${what}時間早於烘焙時間（${roastedAt.slice(0, 10)}），烘後天數會是負的，請確認時間`);
}
const srcFields = (s: Source, at: string) => ({
  roastBatchId: s.rb?.id ?? null,
  roastDeleted: !s.rb && s.batchNo !== "樣品",
  batchNo: s.batchNo,
  coffeeId: s.coffeeId,
  coffeeName: s.coffeeName,
  sampleRoastedDate: s.rb ? null : (s.roastedAt?.slice(0, 10) ?? null),
  restDays: s.roastedAt ? restDays(new Date(s.roastedAt), new Date(at)) : null,
});

/** 修改時的扣庫存：來源改成沒有熟豆庫存的（樣品或另一批）時，先沖銷原本的扣庫存 */
async function syncLabStock(tx: Tx, cur: Doc, src: Source, o: { type: "CUPPING_USE" | "TASTING_USE"; qty: Num | null | undefined; note: string; actor: Actor }) {
  if (src.rb?.invLotId) return syncStock(tx, cur, { ...o, lotId: src.rb.invLotId as string });
  const old = cur.stockTxId ? await tx.get(C.txs, cur.stockTxId as string) : null;
  if (old && !(await tx.get("invTxReversals", old.id))) await reverseTransaction(tx, old.id, o.actor, `${o.note} 改為沒有烘豆紀錄，沖銷原扣庫存`);
  return null;
}

export interface CuppingInput extends BeanSource {
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

async function cuppingFields(tx: Tx, src: Source, i: CuppingInput) {
  const tpl = await tx.must(C.cuppingTemplates, i.templateId, "評分模板");
  timeWarn("杯測", i.cuppedAt, src.roastedAt);
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
    ...srcFields(src, i.cuppedAt),
    templateId: tpl.id,
    templateName: tpl.name,
    cuppedAt: i.cuppedAt,
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
  const src = await beanSource(tx, i);
  const rb = src.rb;
  const fields = await cuppingFields(tx, src, i);
  const s = tx.create(C.cuppings, { ...fields, stockTxId: null as string | null, createdAt: nowIso() });
  if (i.deductStock && rb?.invLotId) {
    s.stockTxId = await syncStock(tx, null, { lotId: rb.invLotId as string, type: "CUPPING_USE", qty: i.consumedG, note: `杯測 ${s.id.slice(0, 8)}`, actor });
    tx.set(C.cuppings, s.id, s);
  }
  audit(tx, actor, "cupping.create", "CuppingSession", s.id, `杯測 ${rb ? src.batchNo : `${src.coffeeName}（樣品）`}`);
  return s;
}

/** 修改杯測：可以改選烘焙批次或咖啡豆；扣庫存數量或來源變動時自動沖銷並重扣 */
export async function updateCupping(tx: Tx, id: string, i: CuppingInput, actor: Actor) {
  const cur = await tx.must(C.cuppings, id, "杯測紀錄");
  const src = await beanSource(tx, i, cur);
  const fields = await cuppingFields(tx, src, i);
  const stockTxId = await syncLabStock(tx, cur, src, { type: "CUPPING_USE", qty: i.deductStock ? i.consumedG : null, note: `杯測 ${id.slice(0, 8)}`, actor });
  tx.set(C.cuppings, id, { ...cur, ...fields, stockTxId, updatedAt: nowIso() });
  audit(tx, actor, "cupping.update", "CuppingSession", id, `修改杯測 ${src.batchNo}`);
}

/** 刪除杯測：若曾扣庫存，自動沖銷回庫存 */
export async function deleteCupping(tx: Tx, id: string, actor: Actor) {
  const cur = await tx.must(C.cuppings, id, "杯測紀錄");
  const rb = cur.roastBatchId ? await tx.get(C.roastBatches, cur.roastBatchId as string) : null;
  if (rb) await syncStock(tx, cur, { lotId: rb.invLotId as string, type: "CUPPING_USE", qty: null, note: `杯測 ${id.slice(0, 8)}`, actor });
  else await syncLabStock(tx, cur, { rb: null, coffeeId: "", coffeeName: "", batchNo: "", roastedAt: null }, { type: "CUPPING_USE", qty: null, note: `杯測 ${id.slice(0, 8)}`, actor });
  await tx.delete(C.cuppings, id);
  audit(tx, actor, "cupping.delete", "CuppingSession", id, `刪除杯測 ${cur.batchNo}（${String(cur.cuppedAt).slice(0, 10)}）`);
}

export interface BrewInput extends BeanSource {
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

async function brewFields(tx: Tx, src: Source, i: BrewInput) {
  timeWarn("沖煮", i.brewedAt, src.roastedAt);
  const dose = D(i.doseG);
  if (dose.lte(0)) throw new DomainError("粉量必須大於 0");
  let cum = D(0);
  const steps = i.pourSteps.map((s, idx) => {
    cum = cum.add(s.waterG);
    if (s.startSec != null && s.endSec != null && s.endSec < s.startSec) warn(`第 ${idx + 1} 段結束時間早於起始時間，請確認`);
    return { stepNo: idx + 1, startSec: s.startSec ?? null, endSec: s.endSec ?? null, waterG: toDb(s.waterG, 2), cumulativeG: toDb(cum, 2), note: s.note ?? null };
  });
  if (steps.length && !cum.eq(i.waterG)) warn(`分段注水合計 ${cum}g 與總水量 ${i.waterG}g 不一致，請確認`);
  const name = async (id?: string | null) => (id ? ((await tx.get(C.equipment, id))?.name as string) ?? null : null);
  const recipe = i.recipeId ? await tx.get(C.brewRecipes, i.recipeId) : null;
  const tags = await upsertTags(tx, i.tags);
  return {
    ...srcFields(src, i.brewedAt),
    recipeId: i.recipeId ?? null,
    recipeLabel: recipe ? `${recipe.name} v${recipe.version}` : null,
    brewedAt: i.brewedAt,
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
  const src = await beanSource(tx, i);
  const rb = src.rb;
  const fields = await brewFields(tx, src, i);
  const s = tx.create(C.brews, { ...fields, stockTxId: null as string | null, createdAt: nowIso() });
  if (i.deductStock && rb?.invLotId) {
    s.stockTxId = await syncStock(tx, null, { lotId: rb.invLotId as string, type: "TASTING_USE", qty: i.doseG, note: `手沖試喝 ${s.id.slice(0, 8)}`, actor });
    tx.set(C.brews, s.id, s);
  }
  audit(tx, actor, "brew.create", "BrewSession", s.id, `手沖 ${rb ? src.batchNo : `${src.coffeeName}（樣品）`}`);
  return s;
}

/** 修改手沖：可以改選烘焙批次或咖啡豆；有扣庫存時以新粉量或新來源沖銷重扣 */
export async function updateBrew(tx: Tx, id: string, i: BrewInput, actor: Actor) {
  const cur = await tx.must(C.brews, id, "沖煮紀錄");
  const src = await beanSource(tx, i, cur);
  const fields = await brewFields(tx, src, i);
  const stockTxId = await syncLabStock(tx, cur, src, { type: "TASTING_USE", qty: i.deductStock ? i.doseG : null, note: `手沖試喝 ${id.slice(0, 8)}`, actor });
  tx.set(C.brews, id, { ...cur, ...fields, stockTxId, updatedAt: nowIso() });
  audit(tx, actor, "brew.update", "BrewSession", id, `修改手沖 ${src.batchNo}`);
}

/** 刪除手沖：若曾扣庫存，自動沖銷回庫存 */
export async function deleteBrew(tx: Tx, id: string, actor: Actor) {
  const cur = await tx.must(C.brews, id, "沖煮紀錄");
  const rb = cur.roastBatchId ? await tx.get(C.roastBatches, cur.roastBatchId as string) : null;
  if (rb) await syncStock(tx, cur, { lotId: rb.invLotId as string, type: "TASTING_USE", qty: null, note: `手沖試喝 ${id.slice(0, 8)}`, actor });
  else await syncLabStock(tx, cur, { rb: null, coffeeId: "", coffeeName: "", batchNo: "", roastedAt: null }, { type: "TASTING_USE", qty: null, note: `手沖試喝 ${id.slice(0, 8)}`, actor });
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
