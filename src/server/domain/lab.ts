/** 杯測與手沖 Domain（研發資料；杯測耗用可選擇同步扣熟豆庫存） */
import { InventoryTxType } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, toDb, type Num } from "@/lib/decimal";
import { DomainError, NotFoundError } from "@/lib/errors";
import { restDays } from "@/lib/time";
import { audit, type Actor } from "./audit";
import { manualAdjust } from "./inventory";

export async function upsertTags(tx: Tx, raw: string | null | undefined) {
  const names = [...new Set((raw ?? "").split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean))].slice(0, 20);
  const tags = [];
  for (const name of names) tags.push(await tx.flavorTag.upsert({ where: { name }, update: {}, create: { name } }));
  return tags;
}

export interface CuppingInput {
  roastBatchId: string;
  templateId: string;
  cuppedAt: Date;
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
  const rb = await tx.roastBatch.findUnique({ where: { id: i.roastBatchId }, include: { inventoryLot: true } });
  if (!rb) throw new NotFoundError("烘焙批次");
  const tpl = await tx.cuppingTemplate.findUnique({ where: { id: i.templateId } });
  if (!tpl) throw new NotFoundError("評分模板");
  if (i.cuppedAt < rb.roastedAt) throw new DomainError("杯測時間不可早於烘焙時間");
  const attrs = tpl.attributes as Array<{ key: string; label: string }>;
  const scores = attrs
    .map((a) => ({ ...a, v: i.scores[a.key] }))
    .filter((a) => a.v != null && a.v !== "")
    .map((a) => {
      const v = D(a.v!);
      if (v.lt(tpl.scaleMin) || v.gt(tpl.scaleMax)) throw new DomainError(`${a.label} 分數需介於 ${tpl.scaleMin}–${tpl.scaleMax}`);
      return { attributeKey: a.key, label: a.label, score: toDb(v, 2) };
    });
  const total = scores.length ? scores.reduce((s, x) => s.add(x.score), D(0)).div(scores.length) : null;
  const tags = await upsertTags(tx, i.tags);
  const session = await tx.cuppingSession.create({
    data: {
      roastBatchId: rb.id,
      templateId: tpl.id,
      cuppedAt: i.cuppedAt,
      restDays: restDays(rb.roastedAt, i.cuppedAt),
      grindSetting: i.grindSetting,
      doseG: i.doseG == null ? null : toDb(i.doseG, 2),
      waterG: i.waterG == null ? null : toDb(i.waterG, 2),
      waterTempC: i.waterTempC == null ? null : toDb(i.waterTempC, 1),
      totalScore: total ? toDb(total, 2) : null,
      defects: i.defects,
      description: i.description,
      evaluator: i.evaluator,
      consumedG: i.consumedG == null ? null : toDb(i.consumedG, 3),
      scores: { create: scores },
      tags: { create: tags.map((t) => ({ flavorTagId: t.id })) },
    },
  });
  if (i.deductStock && i.consumedG && D(i.consumedG).gt(0)) {
    if (!rb.inventoryLot) throw new DomainError("此烘焙批次沒有熟豆庫存批次");
    await manualAdjust(tx, { lotId: rb.inventoryLot.id, type: InventoryTxType.CUPPING_USE, quantity: D(i.consumedG).neg(), actor, note: `杯測 ${session.id.slice(0, 8)}` });
  }
  await audit(tx, actor, "cupping.create", "CuppingSession", session.id, `杯測 ${rb.batchNo}（烘後 ${session.restDays} 天）`);
  return session;
}

export interface BrewInput {
  roastBatchId: string;
  recipeId?: string | null;
  brewedAt: Date;
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
  const rb = await tx.roastBatch.findUnique({ where: { id: i.roastBatchId }, include: { inventoryLot: true } });
  if (!rb) throw new NotFoundError("烘焙批次");
  if (i.brewedAt < rb.roastedAt) throw new DomainError("沖煮時間不可早於烘焙時間");
  const dose = D(i.doseG);
  if (dose.lte(0)) throw new DomainError("粉量必須大於 0");
  let cum = D(0);
  const steps = i.pourSteps.map((s, idx) => {
    cum = cum.add(s.waterG);
    if (s.startSec != null && s.endSec != null && s.endSec < s.startSec) throw new DomainError(`第 ${idx + 1} 段結束時間早於起始時間`);
    return { stepNo: idx + 1, startSec: s.startSec ?? null, endSec: s.endSec ?? null, waterG: toDb(s.waterG, 2), cumulativeG: toDb(cum, 2), note: s.note };
  });
  if (steps.length && !cum.eq(i.waterG)) throw new DomainError(`分段注水合計 ${cum}g 與總水量 ${i.waterG}g 不一致`);
  const tags = await upsertTags(tx, i.tags);
  const session = await tx.brewSession.create({
    data: {
      roastBatchId: rb.id,
      recipeId: i.recipeId || null,
      brewedAt: i.brewedAt,
      restDays: restDays(rb.roastedAt, i.brewedAt),
      grinderId: i.grinderId || null,
      grindSetting: i.grindSetting,
      dripperId: i.dripperId || null,
      filterId: i.filterId || null,
      doseG: toDb(dose, 2),
      waterG: toDb(i.waterG, 2),
      ratio: toDb(D(i.waterG).div(dose), 2),
      waterTempC: i.waterTempC == null ? null : toDb(i.waterTempC, 1),
      waterQuality: i.waterQuality,
      tdsPercent: i.tdsPercent == null ? null : toDb(i.tdsPercent, 2),
      extractionPercent: i.extractionPercent == null ? null : toDb(i.extractionPercent, 2),
      totalTimeSec: i.totalTimeSec ?? null,
      bloomTimeSec: i.bloomTimeSec ?? null,
      bloomWaterG: i.bloomWaterG == null ? null : toDb(i.bloomWaterG, 2),
      pourMethod: i.pourMethod,
      flowRateGPerSec: i.flowRateGPerSec == null ? null : toDb(i.flowRateGPerSec, 2),
      agitation: i.agitation,
      flavorNotes: i.flavorNotes,
      rating: i.rating == null ? null : toDb(i.rating, 1),
      note: i.note,
      isRecommended: i.isRecommended ?? false,
      pourSteps: { create: steps },
      tags: { create: tags.map((t) => ({ flavorTagId: t.id })) },
    },
  });
  if (i.deductStock) {
    if (!rb.inventoryLot) throw new DomainError("此烘焙批次沒有熟豆庫存批次");
    await manualAdjust(tx, { lotId: rb.inventoryLot.id, type: InventoryTxType.TASTING_USE, quantity: dose.neg(), actor, note: `手沖試喝 ${session.id.slice(0, 8)}` });
  }
  await audit(tx, actor, "brew.create", "BrewSession", session.id, `手沖 ${rb.batchNo}（烘後 ${session.restDays} 天）`);
  return session;
}

/** 由沖煮紀錄儲存為配方新版本（同名配方自動遞增版本） */
export async function saveRecipeFromBrew(tx: Tx, brewId: string, name: string, actor: Actor) {
  const b = await tx.brewSession.findUniqueOrThrow({ where: { id: brewId }, include: { pourSteps: { orderBy: { stepNo: "asc" } }, roastBatch: { include: { greenLot: true } } } });
  const existing = await tx.brewRecipe.findFirst({ where: { name }, orderBy: { version: "desc" } });
  const rootId = existing ? (existing.rootId ?? existing.id) : null;
  const latest = existing ? await tx.brewRecipe.findFirst({ where: { OR: [{ id: rootId! }, { rootId: rootId! }] }, orderBy: { version: "desc" } }) : null;
  const recipe = await tx.brewRecipe.create({
    data: {
      name,
      rootId,
      version: latest ? latest.version + 1 : 1,
      coffeeId: b.roastBatch.greenLot.coffeeId,
      grinderId: b.grinderId,
      grindSetting: b.grindSetting,
      dripperId: b.dripperId,
      filterId: b.filterId,
      doseG: b.doseG,
      waterG: b.waterG,
      waterTempC: b.waterTempC,
      bloomWaterG: b.bloomWaterG,
      bloomTimeSec: b.bloomTimeSec,
      totalTimeSec: b.totalTimeSec,
      pourMethod: b.pourMethod,
      agitation: b.agitation,
      pourPlan: b.pourSteps.map((s) => ({ stepNo: s.stepNo, startSec: s.startSec, endSec: s.endSec, waterG: s.waterG.toString() })),
      note: `由沖煮紀錄 ${b.id.slice(0, 8)} 建立`,
    },
  });
  await audit(tx, actor, "recipe.create", "BrewRecipe", recipe.id, `配方 ${name} v${recipe.version}`);
  return recipe;
}
