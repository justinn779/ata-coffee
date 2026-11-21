import { D, toDb, type Num } from "../../../src/lib/decimal";
import { DomainError } from "../../../src/lib/errors";
import { restDays } from "../../../src/lib/time";
import { nowIso, type Tx } from "../tx";
import { C, type Actor } from "../types";
import { audit } from "./core";
import { manualAdjust } from "./inventory";

export async function upsertTags(tx: Tx, raw: string | null | undefined) {
  const names = [...new Set((raw ?? "").split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean))].slice(0, 20);
  for (const name of names) {
    const id = `tag-${Buffer.from(name).toString("hex").slice(0, 60)}`;
    if (!(await tx.get(C.flavorTags, id))) tx.set(C.flavorTags, id, { name, category: null, createdAt: nowIso() });
  }
  return names;
}

const nn = (v: Num | null | undefined, dp: number) => (v == null || v === "" ? null : toDb(v, dp));

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

export async function createCupping(tx: Tx, i: CuppingInput, actor: Actor) {
  const rb = await tx.must(C.roastBatches, i.roastBatchId, "烘焙批次");
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
  const s = tx.create(C.cuppings, {
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
    createdAt: nowIso(),
  });
  if (i.deductStock && i.consumedG && D(i.consumedG).gt(0)) {
    await manualAdjust(tx, { lotId: rb.invLotId as string, type: "CUPPING_USE", quantity: D(i.consumedG).neg(), actor, note: `杯測 ${s.id.slice(0, 8)}` });
  }
  audit(tx, actor, "cupping.create", "CuppingSession", s.id, `杯測 ${rb.batchNo}（烘後 ${s.restDays} 天）`);
  return s;
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

export async function createBrew(tx: Tx, i: BrewInput, actor: Actor) {
  const rb = await tx.must(C.roastBatches, i.roastBatchId, "烘焙批次");
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
  const s = tx.create(C.brews, {
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
    createdAt: nowIso(),
  });
  if (i.deductStock) await manualAdjust(tx, { lotId: rb.invLotId as string, type: "TASTING_USE", quantity: dose.neg(), actor, note: `手沖試喝 ${s.id.slice(0, 8)}` });
  audit(tx, actor, "brew.create", "BrewSession", s.id, `手沖 ${rb.batchNo}（烘後 ${s.restDays} 天）`);
  return s;
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
