"use server";

import { z } from "zod";
import { withTx } from "@/lib/db";
import { bool, optDec, optId, optMmSs, optStr, reqDateTime, reqDec, reqId, reqStr } from "@/lib/zod";
import { action } from "@/server/action";
import { audit } from "@/server/domain/audit";
import { createBrew, saveRecipeFromBrew } from "@/server/domain/lab";

export const saveBrew = action(
  z.object({
    roastBatchId: reqId("烘焙批次"),
    recipeId: optId(),
    brewedAt: reqDateTime("沖煮時間"),
    grinderId: optId(),
    grindSetting: optStr(100),
    dripperId: optId(),
    filterId: optId(),
    doseG: reqDec("粉量", { positive: true }),
    waterG: reqDec("總水量", { positive: true }),
    waterTempC: optDec("水溫", { min: 0 }),
    waterQuality: optStr(200),
    tdsPercent: optDec("TDS", { min: 0 }),
    extractionPercent: optDec("萃取率", { min: 0 }),
    totalTimeSec: optMmSs("總沖煮時間"),
    bloomTimeSec: optMmSs("悶蒸時間"),
    bloomWaterG: optDec("悶蒸水量", { min: 0 }),
    pourMethod: optStr(200),
    flowRateGPerSec: optDec("流速", { min: 0 }),
    agitation: optStr(200),
    flavorNotes: optStr(),
    tags: optStr(500),
    rating: optDec("評價", { min: 0 }),
    note: optStr(),
    isRecommended: bool(),
    deductStock: bool(),
    pourSteps: z.array(z.object({ startSec: optMmSs("起始時間"), endSec: optMmSs("結束時間"), waterG: reqDec("注水量", { positive: true }), note: optStr(200) })).default([]),
  }),
  async (i, actor) => {
    const s = await withTx((tx) => createBrew(tx, i, actor));
    return { id: s.id, redirect: `/brewing/${s.id}` };
  },
  { revalidate: ["/brewing", "/inventory"] },
);

export const toggleRecommended = action(z.object({ id: reqId("沖煮紀錄") }), async ({ id }, actor) => {
  await withTx(async (tx) => {
    const b = await tx.brewSession.findUniqueOrThrow({ where: { id } });
    await tx.brewSession.update({ where: { id }, data: { isRecommended: !b.isRecommended } });
    await audit(tx, actor, "brew.recommend", "BrewSession", id, b.isRecommended ? "取消推薦" : "標記推薦");
  });
}, { revalidate: ["/brewing"] });

export const saveAsRecipe = action(z.object({ brewId: reqId("沖煮紀錄"), name: reqStr("配方名稱", 100) }), async ({ brewId, name }, actor) => {
  const r = await withTx((tx) => saveRecipeFromBrew(tx, brewId, name, actor));
  return { ok: true as const, message: `已儲存配方「${r.name}」第 ${r.version} 版` };
}, { revalidate: ["/brewing"] });

export const toggleRecipeRecommended = action(z.object({ id: reqId("配方") }), async ({ id }, actor) => {
  await withTx(async (tx) => {
    const r = await tx.brewRecipe.findUniqueOrThrow({ where: { id } });
    await tx.brewRecipe.update({ where: { id }, data: { isRecommended: !r.isRecommended } });
    await audit(tx, actor, "recipe.recommend", "BrewRecipe", id, r.isRecommended ? "取消推薦" : "標記推薦");
  });
}, { revalidate: ["/brewing"] });
