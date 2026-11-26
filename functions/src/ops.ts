/**
 * API 操作表：每個操作 = Zod 輸入驗證 + 在 Firestore 交易中執行的 Domain 邏輯。
 * 由 Callable Function `api` 呼叫（已驗證登入與管理員身分），測試亦直接使用本表。
 */
import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { D } from "../../src/lib/decimal";
import { DomainError } from "../../src/lib/errors";
import { bool, boolStr, docId, enumList, isoDate, isoDateTime, optDec, optDocId, optEmail, optInt, optIsoDate, optMmSs, optStr, reqDec, reqInt, reqStr } from "../../src/lib/zod";
import { runTx, nowIso } from "./tx";
import { withSoft } from "./soft";
import { C, type Actor } from "./types";
import { audit, DEFAULT_SETTINGS } from "./domain/core";
import { MANUAL_TX_TYPES, manualAdjust, reverseTransaction, reconcile } from "./domain/inventory";
import { correctGreenCost, receiveGreenPurchase , updateGreenPurchase, deleteGreenPurchase} from "./domain/green";
import { createRoastBatch, deleteRoastBatch, updateRoastBatch, type RoastExtraCost } from "./domain/roasting";
import { cancelProductionOrder, completeProductionOrder, createProductionOrder , updateProductionOrder, reopenProductionOrder, deleteProductionOrder } from "./domain/production";
import { addOrderCost, cancelOrder, completeOrder, confirmPayment, createOrder, createReturn, inspectReturnItem, markPaymentPending, recordRefund, shipOrder, updateOrder , deleteOrder } from "./domain/orders";
import { createBrew, createCupping, deleteBrew, deleteCupping, saveRecipeFromBrew, updateBrew, updateCupping } from "./domain/lab";
import { lossStats, monthlyReport, skuPerformance } from "./domain/reports";
import { cleanOrphanVariants, DELETABLE, deleteCostEntry, deleteMaster } from "./domain/cascade";
import { refreshPublishedTraces, setTracePublished, traceOrder } from "./domain/traceability";
import { addExperiment, createApiKey, deleteExperiment, deleteResearch, updateExperiment, receiveMaterial, saveProduct, saveVariant, setBaseline, setLotStatus, upsert } from "./domain/master";
import { saveCurve, sha256 } from "./domain/curves";
import { MAX_COUNT_LINES, submitStockCount } from "./domain/stockcount";
import { randomBytes } from "node:crypto";
import { realChannels, type Channels } from "./notify/channels";
import { dispatch, getChannels, getNotifySettings, NOTIFY_EVENTS, notifyAfterOp, SECRETS_COL, sendDailySummary } from "./notify/notify";
import { STORE_ADMIN_OPS } from "./shop/admin";
import "./shop/orders"; // 註冊商城訂單掛勾（付款確認、取消、出貨、退款）
import { detectMapping, parseArtisanAlog, parseCsvCurve, preprocessCsv, withComputedRor, type ColumnMapping } from "./curves/parse";

export interface OpCtx {
  db: Firestore;
  actor: Actor;
  /** 讀取 Cloud Storage 檔案（測試時可替換） */
  readFile?: (path: string) => Promise<{ buf: Buffer; name: string }>;
  /** 測試用：注入假的通知管道（Telegram／Email） */
  channels?: Channels;
}

interface Op<S extends z.ZodTypeAny> {
  schema: S;
  run: (input: z.infer<S>, ctx: OpCtx) => Promise<unknown>;
}
/** 選填數值（平板紀錄用） */
const num = (min: number, max: number) => z.number().min(min).max(max).nullable().optional();
const op = <S extends z.ZodTypeAny>(schema: S, run: (input: z.infer<S>, ctx: OpCtx) => Promise<unknown>): Op<S> => ({ schema, run });
const id = z.object({ id: docId("資料") });
/** 修改時的來源：沒傳就沿用原本的（undefined），空字串代表清除 */
const keepId = () => z.preprocess((v) => (v === "" ? null : v), z.string().max(200).nullable().optional());
const srcChange = { roastBatchId: keepId(), coffeeId: keepId() };
const beanSrc = { roastBatchId: optDocId(), coffeeId: optDocId(), roastedDate: optIsoDate() };
const cuppingSchema = z.object({ ...beanSrc, templateId: docId("評分模板"), cuppedAt: isoDateTime("杯測時間"), grindSetting: optStr(100), doseG: optDec("粉量", { min: 0 }), waterG: optDec("水量", { min: 0 }), waterTempC: optDec("水溫", { min: 0 }), scores: z.record(z.string(), optDec("分數", { min: 0 })).default({}), tags: optStr(500), defects: optStr(), description: optStr(), evaluator: optStr(100), consumedG: optDec("耗用量", { min: 0 }), deductStock: bool() });
const brewSchema = z.object({
      ...beanSrc,
      recipeId: optDocId(),
      brewedAt: isoDateTime("沖煮時間"),
      grinderId: optDocId(),
      grindSetting: optStr(100),
      dripperId: optDocId(),
      filterId: optDocId(),
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
    });
const experimentSchema = z.object({ projectId: docId("專案"), label: reqStr("實驗名稱"), experimentDate: isoDate("實驗日期"), isBaseline: boolStr(), variableValues: optStr(), observation: optStr(), roastBatchId: optDocId() });
const tx = <T>(ctx: OpCtx, fn: Parameters<typeof runTx<T>>[1]) => runTx(ctx.db, fn);

const coffeeSchema = z.object({
  id: optDocId(),
  code: optStr(40),
  nameZh: reqStr("中文名稱"),
  nameEn: optStr(200),
  brandName: optStr(200),
  country: optStr(100),
  region: optStr(100),
  farm: optStr(200),
  producer: optStr(200),
  variety: optStr(200),
  process: optStr(100),
  altitude: optStr(100),
  grade: optStr(100),
  supplierId: optDocId(),
  originFlavorNotes: optStr(),
  note: optStr(),
  restStartDays: optInt("建議養豆開始天數", 0, 365),
  peakFromDays: optInt("最佳飲用起始天數", 0, 365),
  peakToDays: optInt("最佳飲用結束天數", 0, 365),
  shelfLifeDays: optInt("預設保存期限", 1, 3650),
  freshnessNote: optStr(),
});


/** 生豆採購欄位（新增與修改共用） */
const greenFields = {
      coffeeId: docId("咖啡豆"),
      supplierId: optDocId(),
      purchaseDate: isoDate("採購日期"),
      receivedAt: isoDateTime("入庫時間"),
      invoiceNo: optStr(100),
      lotCode: optStr(60),
      purchasedWeightG: reqDec("採購數量", { positive: true }),
      receivedWeightG: reqDec("實際入庫數量", { positive: true }),
      unitPricePerKg: reqDec("每公斤單價", { min: 0 }),
      shippingCost: optDec("運費", { min: 0 }),
      otherCost: optDec("其他費用", { min: 0 }),
      moisturePercent: optDec("含水率", { min: 0 }),
      densityGPerL: optDec("密度", { min: 0 }),
      waterActivity: optDec("水活性", { min: 0 }),
      locationId: optDocId(),
      note: optStr(),
};

/** 烘焙批次表單欄位（新增與修改共用） */
const roastFields = {
      greenLotId: optDocId(),
      coffeeId: optDocId(),
      roasterId: docId("烘豆機"),
      roastedAt: isoDateTime("烘焙日期時間"),
      greenWeightG: reqDec("投入生豆重量", { positive: true }),
      roastedWeightG: reqDec("出爐熟豆重量", { positive: true }),
      chargeTempC: optDec("入豆溫"),
      turningPointSec: optMmSs("轉折點時間"),
      turningPointTempC: optDec("轉折點溫度"),
      dryEndSec: optMmSs("轉黃點"),
      firstCrackStartSec: optMmSs("一爆開始"),
      firstCrackEndSec: optMmSs("一爆結束"),
      dropSec: optMmSs("下豆時間"),
      dropTempC: optDec("下豆溫"),
      roastLevel: optStr(50),
      targetProfile: optStr(),
      result: optStr(),
      qualityRating: optInt("品質評價", 1, 10),
      note: optStr(),
      restStartDays: optInt("養豆開始天數", 0, 365),
      peakFromDays: optInt("最佳區間起", 0, 365),
      peakToDays: optInt("最佳區間迄", 0, 365),
      shelfLifeDays: optInt("保存期限", 1, 3650),
      energyCost: optDec("烘焙能源成本", { min: 0 }),
      energyIsEstimate: bool(),
      energyNote: optStr(),
      laborCost: optDec("烘焙人工成本", { min: 0 }),
      laborIsEstimate: bool(),
      copiedFromId: optDocId(),
      events: z.array(z.object({ timeSec: optMmSs("事件時間"), type: reqStr("事件類型", 30), btC: optDec("BT"), etC: optDec("ET"), heat: optStr(50), airflow: optStr(50), drumSpeed: optStr(50), note: optStr(200) })).optional().default([]),
};
type RoastForm = z.infer<z.ZodObject<typeof roastFields>>;
function roastInput(i: RoastForm) {
  const extra: RoastExtraCost[] = [];
  if (i.energyCost && D(i.energyCost).gt(0)) extra.push({ category: "ROAST_ENERGY", amount: i.energyCost, isEstimate: i.energyIsEstimate, calcNote: i.energyNote });
  if (i.laborCost && D(i.laborCost).gt(0)) extra.push({ category: "ROAST_LABOR", amount: i.laborCost, isEstimate: i.laborIsEstimate });
  return { ...i, extraCosts: extra, events: i.events.filter((e) => e.timeSec != null).map((e) => ({ ...e, timeSec: e.timeSec! })) };
}

export const OPS = {
  // ── 咖啡豆與生豆 ──
  "coffee.save": op(coffeeSchema, ({ id, ...d }, ctx) =>
    tx(ctx, async (t) => {
      if (d.peakFromDays != null && d.peakToDays != null && d.peakToDays < d.peakFromDays) throw new DomainError("最佳飲用區間結束天數不可早於起始天數");
      const supplier = d.supplierId ? await t.must(C.suppliers, d.supplierId, "供應商") : null;
      return upsert(t, C.coffees, id, { ...d, supplierName: supplier?.name ?? null, ...(id ? {} : { archivedAt: null }) }, ctx.actor, { unique: "code", label: "咖啡豆" });
    }),
  ),
  "coffee.archive": op(id, ({ id }, ctx) =>
    tx(ctx, async (t) => {
      const c = await t.must(C.coffees, id, "咖啡豆");
      await t.update(C.coffees, id, { archivedAt: c.archivedAt ? null : nowIso() });
      audit(t, ctx.actor, "coffee.archive", "Coffee", id, c.archivedAt ? "取消封存" : "封存");
    }),
  ),
  "green.receive": op(
    z.object({
      ...greenFields,
    }),
    async (i, ctx) => {
      const r = await tx(ctx, (t) => receiveGreenPurchase(t, i, ctx.actor));
      return { id: r.greenLot.id, lotId: r.lot.id };
    },
  ),
  "green.update": op(z.object({ id: docId("生豆批次"), ...greenFields }), ({ id, ...i }, ctx) =>
    tx(ctx, async (t) => {
      const r = await updateGreenPurchase(t, id, i, ctx.actor);
      return { id, message: r.recosted ? `已更新，並重算 ${r.recosted} 批烘焙成本` : "已更新生豆採購" };
    }),
  ),
  "green.delete": op(id, ({ id }, ctx) => tx(ctx, (t) => deleteGreenPurchase(t, id, ctx.actor)).then(() => ({ message: "已刪除生豆採購" }))),
  "green.correctCost": op(z.object({ greenLotId: docId("生豆批次"), unitPricePerKg: reqDec("每公斤單價", { min: 0 }), shippingCost: optDec("運費", { min: 0 }), otherCost: optDec("其他費用", { min: 0 }), reason: reqStr("更正原因") }), async (i, ctx) => {
    const c = await tx(ctx, (t) => correctGreenCost(t, i.greenLotId, i, ctx.actor));
    return { message: `已更正，新每克成本 NT$${c.perG.toFixed(4)}；歷史批次與訂單成本不變` };
  }),

  // ── 烘焙 ──
  "roast.create": op(
    z.object({
      ...roastFields,
      // 平板即時紀錄的曲線點（秒、豆溫、火力、風門、鍋速）
      curvePoints: z.array(z.object({ t: z.number().int().min(0).max(7200), bt: num(-50, 400), heat: num(-1e4, 1e4), air: num(-1e4, 1e4), drum: num(-1e4, 1e4) })).max(500).optional().default([]),
    }),
    async (i, ctx) => {
      const r = await tx(ctx, async (t) => {
        const res = await createRoastBatch(t, roastInput(i), ctx.actor);
        if (i.curvePoints.length) {
          const pts = [...new Map(i.curvePoints.map((p) => [p.t, p])).values()].sort((a, b) => a.t - b.t);
          const points = withComputedRor(pts.map((p) => ({ timeSec: p.t, btC: p.bt ?? null, etC: null, rorC: null, heat: p.heat ?? null, airflow: p.air ?? null, drumSpeed: p.drum ?? null })));
          await saveCurve(t, { roastBatchId: res.batch.id, source: "MANUAL", fileName: "平板即時紀錄", parsed: { points, events: [], rorComputed: true, warnings: [] } }, ctx.actor);
        }
        return res;
      });
      return { id: r.batch.id };
    },
  ),
  "roast.update": op(z.object({ id: docId("烘焙批次"), ...roastFields }), ({ id, ...i }, ctx) =>
    tx(ctx, async (t) => {
      await updateRoastBatch(t, id, roastInput(i), ctx.actor);
      await refreshPublishedTraces(t);
      return { id, message: "已更新烘焙批次" };
    }),
  ),
  "roast.delete": op(id, ({ id }, ctx) => tx(ctx, (t) => deleteRoastBatch(t, id, ctx.actor)).then(() => ({ message: "已刪除烘焙批次" }))),
  "roast.updateNotes": op(z.object({ id: docId("烘焙批次"), roastLevel: optStr(50), targetProfile: optStr(), result: optStr(), qualityRating: optInt("品質評價", 1, 10), note: optStr() }), ({ id, ...d }, ctx) =>
    tx(ctx, async (t) => {
      await t.update(C.roastBatches, id, { ...d, updatedAt: nowIso() });
      audit(t, ctx.actor, "roast.updateNotes", "RoastBatch", id, "更新烘焙評價與備註");
      return { message: "已更新（重量與時間等已過帳數據不可修改）" };
    }),
  ),
  "curve.preview": op(z.object({ storagePath: reqStr("檔案", 500), fileName: reqStr("檔名", 200), mapping: z.record(z.string(), z.string()).nullable().optional(), unit: z.enum(["C", "F"]).default("C"), roastBatchId: optDocId() }), async (i, ctx) => {
    const { buf } = await ctx.readFile!(i.storagePath);
    const p = parseCurveFile(buf, i.fileName, i.mapping ?? null, i.unit);
    const dup = i.roastBatchId ? (await ctx.db.collection(C.uniq).doc(`curve:${i.roastBatchId}:${sha256(buf)}`).get()).exists : false;
    return { ...p.summary, duplicate: dup };
  }),
  "curve.import": op(z.object({ storagePath: reqStr("檔案", 500), fileName: reqStr("檔名", 200), mapping: z.record(z.string(), z.string()).nullable().optional(), unit: z.enum(["C", "F"]).default("C"), roastBatchId: docId("烘焙批次"), importEvents: z.boolean().default(false) }), async (i, ctx) => {
    const { buf } = await ctx.readFile!(i.storagePath);
    const p = parseCurveFile(buf, i.fileName, i.mapping ?? null, i.unit);
    await tx(ctx, (t) => saveCurve(t, { roastBatchId: i.roastBatchId, source: p.format, fileName: i.fileName, storagePath: i.storagePath, fileSha256: sha256(buf), mapping: p.mapping, parsed: p.parsed, importEvents: i.importEvents }, ctx.actor));
    return { message: "曲線已匯入並保存原始檔" };
  }),
  "curve.activate": op(z.object({ curveId: docId("曲線") }), ({ curveId }, ctx) =>
    tx(ctx, async (t) => {
      const c = await t.must(C.roastCurves, curveId, "曲線");
      for (const o of await t.query(C.roastCurves, [["roastBatchId", "==", c.roastBatchId]])) await t.update(C.roastCurves, o.id, { isActive: o.id === curveId });
      audit(t, ctx.actor, "curve.activate", "RoastCurve", curveId, "切換使用中曲線");
    }),
  ),
  "curve.delete": op(z.object({ curveId: docId("曲線") }), ({ curveId }, ctx) =>
    tx(ctx, async (t) => {
      const c = await t.must(C.roastCurves, curveId, "曲線");
      const others = (await t.query(C.roastCurves, [["roastBatchId", "==", c.roastBatchId]])).filter((o) => o.id !== curveId).sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt)));
      for (let i = 0; i < ((c.chunkCount as number) ?? 0); i++) await t.delete(`${C.roastCurves}/${curveId}/chunks`, String(i));
      if (c.fileSha256) await t.delete(C.uniq, `curve:${c.roastBatchId}:${c.fileSha256}`);
      await t.delete(C.roastCurves, curveId);
      if (c.isActive && others[0] && !others.some((o) => o.isActive)) await t.update(C.roastCurves, others[0].id, { isActive: true });
      audit(t, ctx.actor, "curve.delete", "RoastCurve", curveId, `刪除曲線 ${c.originalFileName ?? ""}（${c.batchNo}）`);
      return { message: "已刪除曲線" };
    }),
  ),

  // ── 杯測／手沖／研究 ──
  "cupping.create": op(
    cuppingSchema,
    async (i, ctx) => ({ id: (await tx(ctx, (t) => createCupping(t, i, ctx.actor))).id }),
  ),
  "cupping.update": op(cuppingSchema.extend({ ...srcChange, id: docId("杯測紀錄") }), ({ id, ...i }, ctx) => tx(ctx, (t) => updateCupping(t, id, i, ctx.actor)).then(() => ({ id, message: "已更新杯測紀錄" }))),
  "cupping.delete": op(id, ({ id }, ctx) => tx(ctx, (t) => deleteCupping(t, id, ctx.actor)).then(() => ({ message: "已刪除杯測紀錄" }))),
  "brew.create": op(
    brewSchema,
    async (i, ctx) => ({ id: (await tx(ctx, (t) => createBrew(t, i, ctx.actor))).id }),
  ),
  "brew.update": op(brewSchema.extend({ ...srcChange, id: docId("沖煮紀錄") }), ({ id, ...i }, ctx) => tx(ctx, (t) => updateBrew(t, id, i, ctx.actor)).then(() => ({ id, message: "已更新沖煮紀錄" }))),
  "brew.delete": op(id, ({ id }, ctx) => tx(ctx, (t) => deleteBrew(t, id, ctx.actor)).then(() => ({ message: "已刪除沖煮紀錄" }))),
  "brew.toggleRecommended": op(id, ({ id }, ctx) =>
    tx(ctx, async (t) => {
      const b = await t.must(C.brews, id, "沖煮紀錄");
      await t.update(C.brews, id, { isRecommended: !b.isRecommended });
      audit(t, ctx.actor, "brew.recommend", "BrewSession", id, b.isRecommended ? "取消推薦" : "標記推薦");
    }),
  ),
  "recipe.saveFromBrew": op(z.object({ brewId: docId("沖煮紀錄"), name: reqStr("配方名稱", 100) }), async (i, ctx) => {
    const r = await tx(ctx, (t) => saveRecipeFromBrew(t, i.brewId, i.name, ctx.actor));
    return { message: `已儲存配方「${r.name}」第 ${r.version} 版` };
  }),
  "recipe.toggleRecommended": op(id, ({ id }, ctx) =>
    tx(ctx, async (t) => {
      const r = await t.must(C.brewRecipes, id, "配方");
      await t.update(C.brewRecipes, id, { isRecommended: !r.isRecommended });
      audit(t, ctx.actor, "recipe.recommend", "BrewRecipe", id, "切換推薦");
    }),
  ),
  "research.save": op(
    z.object({ id: optDocId(), name: reqStr("專案名稱"), hypothesis: optStr(), objective: optStr(), controlledVariables: optStr(), independentVariables: optStr(), status: z.enum(["PLANNING", "RUNNING", "CONCLUDED", "ARCHIVED"]).default("PLANNING"), startDate: optIsoDate(), result: optStr(), conclusion: optStr(), nextSteps: optStr() }),
    ({ id, ...d }, ctx) => tx(ctx, async (t) => upsert(t, C.research, id, id ? d : { ...d, code: await import("./domain/core").then((m) => m.nextNumber(t, "RP", { daily: false })), experiments: [] }, ctx.actor, { label: "研究專案" })),
  ),
  "research.addExperiment": op(experimentSchema, (i, ctx) => tx(ctx, (t) => addExperiment(t, i, ctx.actor)).then(() => ({ message: "已新增實驗版本" }))),
  "research.updateExperiment": op(experimentSchema.extend({ expId: reqStr("實驗") }), (i, ctx) => tx(ctx, (t) => updateExperiment(t, i, ctx.actor)).then(() => ({ message: "已更新實驗版本" }))),
  "research.deleteExperiment": op(z.object({ projectId: docId("專案"), expId: reqStr("實驗") }), (i, ctx) => tx(ctx, (t) => deleteExperiment(t, i.projectId, i.expId, ctx.actor)).then(() => ({ message: "已刪除實驗版本" }))),
  "research.delete": op(id, ({ id }, ctx) => tx(ctx, (t) => deleteResearch(t, id, ctx.actor)).then(() => ({ message: "已刪除研究專案" }))),
  "research.setBaseline": op(z.object({ projectId: docId("專案"), expId: reqStr("實驗") }), (i, ctx) => tx(ctx, (t) => setBaseline(t, i.projectId, i.expId, ctx.actor))),


  // ── 通知（Telegram／Gmail） ──
  "notify.save": op(
    z.object({
      gmailUser: optEmail(),
      emailTo: optStr(1000),
      dailyTelegram: bool(),
      dailyEmail: bool(),
      ...Object.fromEntries(NOTIFY_EVENTS.flatMap((e) => [[`tg_${e}`, bool()], [`em_${e}`, bool()]])),
    }),
    async (i, ctx) => {
      const emailTo = [...new Set((i.emailTo ?? "").split(/[,，;\s]+/).map((x) => x.trim()).filter(Boolean))];
      const bad = emailTo.filter((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
      if (bad.length) throw new DomainError(`收件 Email 格式錯誤：${bad.join("、")}`);
      if (emailTo.length > 10) throw new DomainError("收件人最多 10 位");
      const flags = i as unknown as Record<string, boolean>;
      return tx(ctx, async (t) => {
        const cur = ((await t.get(C.settings, "notify")) ?? {}) as Record<string, unknown>;
        t.set(C.settings, "notify", {
          ...cur,
          gmailUser: i.gmailUser,
          emailTo,
          dailyTelegram: i.dailyTelegram,
          dailyEmail: i.dailyEmail,
          tgEvents: Object.fromEntries(NOTIFY_EVENTS.map((e) => [e, flags[`tg_${e}`]])),
          emailEvents: Object.fromEntries(NOTIFY_EVENTS.map((e) => [e, flags[`em_${e}`]])),
          // 更換寄件帳號時，原本的應用程式密碼失效
          ...(cur.gmailUser && cur.gmailUser !== i.gmailUser ? { hasGmailPassword: false } : {}),
        });
        if (cur.gmailUser && cur.gmailUser !== i.gmailUser) {
          const sec = (await t.get(SECRETS_COL, "notify")) ?? {};
          t.set(SECRETS_COL, "notify", { ...sec, gmailAppPassword: null });
        }
        audit(t, ctx.actor, "notify.save", "Settings", "notify", "更新通知設定");
        return { message: "已儲存通知設定" };
      });
    },
  ),
  /** 設定金鑰（只寫不讀）：Telegram 機器人金鑰、Gmail 應用程式密碼；儲存前先驗證可用 */
  "notify.setSecrets": op(z.object({ telegramBotToken: optStr(200), gmailAppPassword: optStr(100), clearTelegram: bool(), clearGmail: bool() }), async (i, ctx) => {
    const settings = await getNotifySettings(ctx.db);
    const patch: Record<string, unknown> = {};
    const sec: Record<string, unknown> = {};
    if (i.clearTelegram) {
      sec.telegramBotToken = null;
      Object.assign(patch, { hasTelegramToken: false, telegramBot: null, telegramChatId: null, telegramChatTitle: null });
    }
    if (i.clearGmail) {
      sec.gmailAppPassword = null;
      patch.hasGmailPassword = false;
    }
    if (i.telegramBotToken) {
      if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(i.telegramBotToken)) throw new DomainError("Telegram 機器人金鑰格式不正確（應類似 123456789:AAH…，由 @BotFather 提供）");
      const ch = ctx.channels ?? realChannels({ telegramBotToken: i.telegramBotToken });
      const me = await ch.telegramMe!();
      Object.assign(sec, { telegramBotToken: i.telegramBotToken });
      Object.assign(patch, { hasTelegramToken: true, telegramBot: me.username, ...(settings.telegramBot && settings.telegramBot !== me.username ? { telegramChatId: null, telegramChatTitle: null } : {}) });
    }
    if (i.gmailAppPassword) {
      if (!settings.gmailUser) throw new DomainError("請先填寫並儲存「寄件 Gmail 帳號」");
      const ch = ctx.channels ?? realChannels({ gmailUser: settings.gmailUser, gmailAppPassword: i.gmailAppPassword });
      await ch.emailVerify!();
      Object.assign(sec, { gmailAppPassword: i.gmailAppPassword });
      Object.assign(patch, { hasGmailPassword: true });
    }
    if (!Object.keys(sec).length) throw new DomainError("沒有要更新的項目");
    await tx(ctx, async (t) => {
      const cur = (await t.get(SECRETS_COL, "notify")) ?? {};
      t.set(SECRETS_COL, "notify", { ...cur, ...sec, updatedAt: nowIso() });
      const st = (await t.get(C.settings, "notify")) ?? {};
      t.set(C.settings, "notify", { ...st, ...patch });
      // 稽核只記錄「更新了哪一項」，不記錄金鑰內容
      audit(t, ctx.actor, "notify.secrets", "Settings", "notify", `更新通知金鑰：${Object.keys(sec).map((k) => ({ telegramBotToken: "Telegram 機器人", gmailAppPassword: "Gmail 應用程式密碼" })[k] ?? k).join("、")}`);
    });
    return { message: i.telegramBotToken ? `已連上 Telegram 機器人 @${patch.telegramBot}，下一步請連結聊天室` : "已更新" };
  }),
  "notify.linkStart": op(z.object({}), async (_i, ctx) => {
    const s = await getNotifySettings(ctx.db);
    if (!s.hasTelegramToken || !s.telegramBot) throw new DomainError("請先設定 Telegram 機器人金鑰");
    const code = randomBytes(4).toString("hex").toUpperCase();
    await tx(ctx, async (t) => {
      const st = (await t.get(C.settings, "notify")) ?? {};
      t.set(C.settings, "notify", { ...st, linkCode: code, linkCodeAt: nowIso() });
    });
    return { code, bot: s.telegramBot, link: `https://t.me/${s.telegramBot}?start=${code}` };
  }),
  "notify.linkDetect": op(z.object({}), async (_i, ctx) => {
    const s = await getNotifySettings(ctx.db);
    if (!s.linkCode || !s.linkCodeAt || Date.now() - Date.parse(s.linkCodeAt) > 30 * 60_000) throw new DomainError("驗證碼已過期，請重新按「開始連結」");
    const ch = await getChannels(ctx);
    if (!ch.telegramUpdates) throw new DomainError("請先設定 Telegram 機器人金鑰");
    const hit = (await ch.telegramUpdates()).reverse().find((u) => u.text.includes(s.linkCode!));
    if (!hit) throw new DomainError(`還沒收到驗證碼。請在 Telegram 對 @${s.telegramBot} 傳送「/start ${s.linkCode}」後再按一次`);
    await tx(ctx, async (t) => {
      const st = (await t.get(C.settings, "notify")) ?? {};
      t.set(C.settings, "notify", { ...st, telegramChatId: hit.chatId, telegramChatTitle: hit.title || null, linkCode: null, linkCodeAt: null });
      audit(t, ctx.actor, "notify.link", "Settings", "notify", `連結 Telegram 聊天室 ${hit.title}`);
    });
    await ch.telegram!(hit.chatId, "✅ 已連結 <b>ATA Coffee 管理系統</b>，之後的通知會傳到這裡。");
    return { message: `已連結 Telegram：${hit.title || hit.chatId}` };
  }),
  "notify.unlinkTelegram": op(z.object({}), (_i, ctx) =>
    tx(ctx, async (t) => {
      const st = (await t.get(C.settings, "notify")) ?? {};
      t.set(C.settings, "notify", { ...st, telegramChatId: null, telegramChatTitle: null });
      audit(t, ctx.actor, "notify.unlink", "Settings", "notify", "解除 Telegram 聊天室");
      return { message: "已解除 Telegram 聊天室" };
    }),
  ),
  "notify.test": op(z.object({}), async (_i, ctx) => {
    const r = await dispatch(ctx, "test", { title: "🔔 測試通知", lines: ["這是一則測試訊息，收到代表通知設定成功。"], path: "/settings/?s=notify" }, { force: true });
    if (!r.length) throw new DomainError("尚未設定任何可用的通知管道（Telegram 聊天室或 Email 收件人）");
    const fail = r.filter((x) => !x.ok);
    if (fail.length) throw new DomainError(fail.map((x) => `${x.channel === "telegram" ? "Telegram" : "Email"}：${x.error}`).join("\n"));
    return { message: `已送出測試通知：${r.map((x) => (x.channel === "telegram" ? "Telegram" : "Email")).join("、")}` };
  }),
  "notify.dailyNow": op(z.object({}), async (_i, ctx) => {
    const r = await sendDailySummary(ctx);
    if (!r.length) throw new DomainError("每日彙整未啟用任何管道，或尚未設定 Telegram 聊天室／Email 收件人");
    const fail = r.filter((x) => !x.ok);
    if (fail.length) throw new DomainError(fail.map((x) => x.error).join("\n"));
    return { message: "已送出今日彙整" };
  }),

  // ── 庫存 ──
  "inventory.adjust": op(
    z.object({ lotId: docId("批次"), type: enumList(MANUAL_TX_TYPES, "異動類型"), direction: z.enum(["out", "in"]).default("out"), quantity: reqDec("數量", { positive: true }), note: optStr(500), idempotencyKey: z.string().max(100).optional() }),
    async (i, ctx) => {
      const q = D(i.quantity);
      await tx(ctx, (t) => manualAdjust(t, { lotId: i.lotId, type: i.type, quantity: i.type === "ADJUSTMENT" && i.direction === "in" ? q : q.neg(), note: i.note, actor: ctx.actor, idempotencyKey: i.idempotencyKey }));
      return { message: "庫存異動已過帳" };
    },
  ),
  "inventory.count": op(
    z.object({
      countId: reqStr("盤點識別碼", 100),
      note: optStr(500),
      lines: z.array(z.object({ lotId: docId("批次"), expected: reqDec("帳面數量", { min: 0 }), counted: reqDec("實盤數量", { min: 0 }) })).min(1, "請至少輸入一個批次的實盤數量").max(MAX_COUNT_LINES, `一次最多盤點 ${MAX_COUNT_LINES} 個批次`),
    }),
    async (i, ctx) => {
      const r = await tx(ctx, (t) => submitStockCount(t, i, ctx.actor));
      return { id: r.count.id, duplicate: r.duplicate, message: r.duplicate ? "此盤點已送出過，未重複調整" : `盤點 ${r.count.code} 完成：${r.count.changedCount} 批有差異` };
    },
  ),
  "inventory.reverse": op(z.object({ txId: docId("交易"), note: reqStr("沖銷原因") }), (i, ctx) => tx(ctx, (t) => reverseTransaction(t, i.txId, ctx.actor, i.note)).then(() => ({ message: "已建立沖銷交易（原交易保留）" }))),
  "inventory.lotStatus": op(z.object({ lotId: docId("批次"), status: z.enum(["AVAILABLE", "HOLD"]), note: reqStr("原因") }), (i, ctx) => tx(ctx, (t) => setLotStatus(t, i, ctx.actor)).then(() => ({ message: "批次狀態已更新" }))),
  "inventory.threshold": op(z.object({ itemId: docId("品項"), threshold: reqDec("預警數量", { min: 0 }) }), (i, ctx) =>
    tx(ctx, async (t) => {
      await t.update(C.items, i.itemId, { lowStockThreshold: i.threshold });
      audit(t, ctx.actor, "item.threshold", "InvItem", i.itemId, `預警數量 ${i.threshold}`);
      return { message: "已更新預警設定" };
    }),
  ),
  "inventory.receiveMaterial": op(z.object({ materialId: docId("包材"), quantity: reqDec("數量", { positive: true }), unitCost: reqDec("單位成本", { min: 0 }), note: optStr(500) }), async (i, ctx) => ({ lotId: (await tx(ctx, (t) => receiveMaterial(t, i, ctx.actor))).id })),
  "inventory.reconcile": op(z.object({}), async (_i, ctx) => reconcile(ctx.db)),

  // ── 分裝 ──
  "production.create": op(z.object({ sourceLotId: docId("熟豆批次"), targetVariantId: docId("目標品項"), plannedQty: reqInt("預計生產數量"), fillWeightG: optDec("單包重量", { min: 0 }), plannedDate: isoDate("生產日期"), note: optStr() }), async (i, ctx) => ({ id: (await tx(ctx, (t) => createProductionOrder(t, { ...i, mode: "PRE_PACK" }, ctx.actor))).id })),
  /** 一步完成分裝：選熟豆、規格、包數，直接扣熟豆與包材、產出成品（不用先建分裝單再完成） */
  "production.quick": op(
    z.object({ sourceLotId: docId("熟豆批次"), targetVariantId: docId("要裝成的商品規格"), qty: reqInt("包數"), fillWeightG: optDec("每包重量", { min: 0 }), lossG: optDec("損耗", { min: 0 }), packedDate: isoDate("分裝日期"), note: optStr() }),
    async (i, ctx) => {
      const r = await tx(ctx, async (t) => {
        const po = await createProductionOrder(t, { sourceLotId: i.sourceLotId, targetVariantId: i.targetVariantId, plannedQty: i.qty, fillWeightG: i.fillWeightG, plannedDate: i.packedDate, note: i.note }, ctx.actor);
        const done = await completeProductionOrder(t, po.id, { actualQty: i.qty, lossG: i.lossG, completedAt: new Date(`${i.packedDate}T12:00:00+08:00`).toISOString(), note: i.note, laborIsEstimate: true }, ctx.actor);
        return { id: po.id, done };
      });
      return { id: r.id, message: `分裝完成 ${r.done.packagingBatch.batchNo}：${i.qty} 包，每包成本 NT$${r.done.unitCost.toFixed(2)}` };
    },
  ),
  "production.complete": op(
    z.object({ id: docId("生產單"), actualQty: reqInt("實際生產數量"), lossG: optDec("損耗", { min: 0 }), laborCost: optDec("包裝人工", { min: 0 }), qualityStatus: z.enum(["PASS", "HOLD", "FAIL"]).default("PASS"), expiryDate: optIsoDate(), note: optStr() }),
    async ({ id, ...i }, ctx) => {
      const r = await tx(ctx, (t) => completeProductionOrder(t, id, { ...i, laborIsEstimate: true }, ctx.actor));
      return { message: `完成分裝 ${r.packagingBatch.batchNo}，每件成本 NT$${r.unitCost.toFixed(2)}` };
    },
  ),
  "production.update": op(z.object({ id: docId("生產單"), plannedQty: reqInt("預計生產數量"), fillWeightG: optDec("單包重量", { min: 0 }), plannedDate: isoDate("生產日期"), note: optStr() }), ({ id, ...i }, ctx) =>
    tx(ctx, (t) => updateProductionOrder(t, id, i, ctx.actor)).then(() => ({ message: "已更新生產單並重新預留熟豆" })),
  ),
  "production.reopen": op(id, ({ id }, ctx) => tx(ctx, (t) => reopenProductionOrder(t, id, ctx.actor)).then(() => ({ message: "已撤銷完成：熟豆與包材已退回，可修改後再完成" }))),
  "production.delete": op(id, ({ id }, ctx) => tx(ctx, (t) => deleteProductionOrder(t, id, ctx.actor)).then(() => ({ message: "已刪除生產單" }))),
  "production.cancel": op(z.object({ id: docId("生產單"), reason: optStr(300) }), (i, ctx) => tx(ctx, (t) => cancelProductionOrder(t, i.id, ctx.actor, { reason: i.reason })).then(() => ({ message: "已取消並釋放熟豆預留" }))),

  // ── 商品 ──
  "product.save": op(
    z.object({ id: optDocId(), code: optStr(40), name: reqStr("商品名稱"), category: z.enum(["COFFEE_BEAN", "DRIP_BAG", "DRIP_BAG_SET", "GIFT_BOX", "MERCH", "OTHER"]), brandSeriesId: optDocId(), coffeeId: optDocId(), description: optStr(), flavorNotes: optStr(), status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]), isLimited: bool(), saleStartDate: optIsoDate(), saleEndDate: optIsoDate() }),
    (i, ctx) => tx(ctx, (t) => saveProduct(t, i, ctx.actor)),
  ),
  "variant.save": op(
    z.object({
      id: optDocId(),
      productId: docId("商品"),
      sku: optStr(60),
      name: reqStr("規格名稱"),
      listPrice: optDec("原價", { min: 0 }),
      salePrice: reqDec("售價", { min: 0 }),
      standardCost: optDec("估計成本", { min: 0 }),
      fillWeightG: optDec("填充重量", { min: 0 }),
      isBundle: bool(),
      stockPolicy: z.enum(["STOCK_ONLY", "MADE_TO_ORDER", "NOT_TRACKED"]),
      status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]),
      materials: z.array(z.object({ materialId: docId("包材"), quantityPerUnit: reqDec("每件用量", { positive: true }) })).default([]),
      components: z.array(z.object({ componentVariantId: docId("組件"), quantity: reqDec("數量", { positive: true }) })).default([]),
    }),
    (i, ctx) => tx(ctx, (t) => saveVariant(t, { ...i, listPrice: i.listPrice ?? i.salePrice }, ctx.actor)),
  ),
  /** 簡單版新增商品：商品與各規格（例：100g、200g）一次建好；其他設定用預設值（上架、現貨、原價＝售價） */
  "variant.cleanOrphans": op(z.object({}), async (_i, ctx) => {
    const n = await tx(ctx, (t) => cleanOrphanVariants(t, ctx.actor));
    return { message: n ? `已清除 ${n} 個殘留的規格` : "沒有需要清除的規格" };
  }),
  "product.quickCreate": op(
    z.object({
      name: reqStr("商品名稱"),
      category: z.enum(["COFFEE_BEAN", "DRIP_BAG", "DRIP_BAG_SET", "GIFT_BOX", "MERCH", "OTHER"]).default("COFFEE_BEAN"),
      coffeeId: optDocId(),
      sizes: z.array(z.object({ name: reqStr("規格名稱", 100), fillWeightG: optDec("每包重量", { min: 0 }), salePrice: reqDec("售價", { min: 0 }), materialId: optDocId(), materialId2: optDocId() })).min(1, "至少要有一種規格"),
    }),
    (i, ctx) =>
      tx(ctx, async (t) => {
        const p = await saveProduct(t, { name: i.name, category: i.category, coffeeId: i.coffeeId ?? null, status: "ACTIVE", isLimited: false }, ctx.actor);
        for (const sz of i.sizes) {
          const mats = [sz.materialId, sz.materialId2].filter((m): m is string => !!m).map((materialId) => ({ materialId, quantityPerUnit: "1" }));
          await saveVariant(t, { productId: p.id, name: sz.name, listPrice: sz.salePrice, salePrice: sz.salePrice, fillWeightG: sz.fillWeightG ?? null, isBundle: false, stockPolicy: "STOCK_ONLY", status: "ACTIVE", materials: mats, components: [] }, ctx.actor);
        }
        return { id: p.id, message: `已建立商品「${i.name}」與 ${i.sizes.length} 種規格` };
      }),
  ),

  // ── 訂單 ──
  "order.create": op(
    z.object({
      customerId: optDocId(),
      customerName: optStr(100),
      customerPhone: optStr(50),
      customerEmail: optStr(200),
      shippingAddress: optStr(500),
      shippingMethod: optStr(100),
      shippingFee: optDec("運費", { min: 0 }),
      note: optStr(),
      idempotencyKey: z.string().max(100).optional(),
      items: z.array(z.object({ variantId: docId("商品"), quantity: reqInt("數量"), discount: optDec("折扣", { min: 0 }) })).min(1, "至少需要一項商品"),
    }),
    async (i, ctx) => {
      const r = await tx(ctx, async (t) => {
        const c = i.customerId ? await t.must(C.customers, i.customerId, "顧客") : null;
        const name = i.customerName || (c?.name as string);
        if (!name) throw new DomainError("請選擇顧客或填寫顧客名稱");
        return createOrder(t, { ...i, customerName: name, customerPhone: i.customerPhone || (c?.phone as string) || null, customerEmail: i.customerEmail || (c?.email as string) || null, shippingAddress: i.shippingAddress || (c?.address as string) || null }, ctx.actor);
      });
      return { id: r.order.id, duplicate: r.duplicate };
    },
  ),
  /** 任何狀態的訂單都可修改顧客、收件、出貨單號與備註（不影響金額、品項與庫存） */
  "order.updateInfo": op(
    z.object({ orderId: docId("訂單"), customerName: reqStr("顧客名稱", 100), customerPhone: optStr(50), customerEmail: optStr(200), shippingAddress: optStr(500), shippingMethod: optStr(100), carrier: optStr(100), trackingNo: optStr(100), note: optStr() }),
    ({ orderId, carrier, trackingNo, ...d }, ctx) =>
      tx(ctx, async (t) => {
        const o = await t.must(C.orders, orderId, "訂單");
        const shipment = o.shipment ? { ...(o.shipment as object), carrier: carrier ?? null, trackingNo: trackingNo ?? null } : undefined;
        await t.update(C.orders, orderId, { ...d, ...(shipment ? { shipment } : {}), updatedAt: nowIso() });
        audit(t, ctx.actor, "order.updateInfo", "SalesOrder", orderId, `修改訂單 ${o.orderNo} 的顧客／收件資訊`);
        return { message: "已更新訂單資訊" };
      }),
  ),
  "order.update": op(
    z.object({
      orderId: docId("訂單"),
      customerId: optDocId(),
      customerName: optStr(100),
      customerPhone: optStr(50),
      customerEmail: optStr(200),
      shippingAddress: optStr(500),
      shippingMethod: optStr(100),
      shippingFee: optDec("運費", { min: 0 }),
      note: optStr(),
      items: z.array(z.object({ variantId: docId("商品"), quantity: reqInt("數量"), discount: optDec("折扣", { min: 0 }) })).min(1, "至少需要一項商品"),
    }),
    async ({ orderId, ...i }, ctx) => {
      const o = await tx(ctx, async (t) => {
        const c = i.customerId ? await t.must(C.customers, i.customerId, "顧客") : null;
        const name = i.customerName || (c?.name as string);
        if (!name) throw new DomainError("請選擇顧客或填寫顧客名稱");
        return updateOrder(t, orderId, { ...i, customerName: name }, ctx.actor);
      });
      return { id: o.id, message: `已修改訂單，金額 ${o.total}` };
    },
  ),
  "order.markPending": op(z.object({ orderId: docId("訂單"), reference: optStr(100) }), (i, ctx) => tx(ctx, (t) => markPaymentPending(t, i.orderId, ctx.actor, i.reference)).then(() => ({ message: "已標記為待確認" }))),
  "order.confirmPayment": op(z.object({ orderId: docId("訂單"), method: z.enum(["BANK_TRANSFER", "CASH", "CARD", "OTHER"]).default("BANK_TRANSFER"), reference: optStr(100), note: optStr(500) }), async ({ orderId, ...i }, ctx) => {
    const r = await tx(ctx, (t) => confirmPayment(t, orderId, i, ctx.actor));
    return { message: r.alreadyPaid ? "此訂單先前已確認付款，未重複記錄" : "已確認付款", alreadyPaid: r.alreadyPaid };
  }),
  "order.ship": op(z.object({ orderId: docId("訂單"), carrier: optStr(100), trackingNo: optStr(100), method: optStr(100), shippingCost: optDec("物流成本", { min: 0 }), note: optStr(500) }), ({ orderId, ...i }, ctx) => tx(ctx, (t) => shipOrder(t, orderId, i, ctx.actor)).then(() => ({ message: "已出貨並扣除成品庫存" }))),
  "order.complete": op(z.object({ orderId: docId("訂單") }), (i, ctx) => tx(ctx, (t) => completeOrder(t, i.orderId, ctx.actor)).then(() => ({ message: "訂單已完成" }))),
  "order.delete": op(id, ({ id }, ctx) => tx(ctx, (t) => deleteOrder(t, id, ctx.actor)).then(() => ({ message: "已刪除訂單，保留的庫存已釋放" }))),
  "order.cancel": op(z.object({ orderId: docId("訂單"), reason: optStr(300), refundAmount: optDec("退款金額", { min: 0 }) }), ({ orderId, ...i }, ctx) => tx(ctx, (t) => cancelOrder(t, orderId, i, ctx.actor)).then(() => ({ message: "訂單已取消，保留已釋放" }))),
  "order.refund": op(z.object({ orderId: docId("訂單"), amount: reqDec("退款金額", { positive: true }), reference: optStr(100), note: optStr(500) }), ({ orderId, ...i }, ctx) => tx(ctx, (t) => recordRefund(t, orderId, i, ctx.actor)).then(() => ({ message: "已記錄退款" }))),
  "order.return": op(z.object({ orderId: docId("訂單"), reason: optStr(500), items: z.array(z.object({ allocationId: docId("分配"), quantity: reqDec("數量", { positive: true }) })).min(1, "請選擇退貨品項") }), ({ orderId, ...i }, ctx) => tx(ctx, (t) => createReturn(t, orderId, i, ctx.actor)).then(() => ({ message: "已建立退貨，商品進入待檢庫存（不可售）" }))),
  "order.inspectReturn": op(z.object({ returnId: docId("退貨單"), itemId: reqStr("明細"), disposition: z.enum(["RESTOCK", "SCRAP"]), note: optStr(300) }), (i, ctx) => tx(ctx, (t) => inspectReturnItem(t, i.returnId, i.itemId, i.disposition, ctx.actor, i.note)).then(() => ({ message: i.disposition === "RESTOCK" ? "檢查合格，已重新入庫" : "已報廢" }))),
  "order.addCost": op(z.object({ orderId: docId("訂單"), category: z.enum(["SHIPPING", "PLATFORM_FEE", "PAYMENT_FEE", "ORDER_OTHER"]), amount: reqDec("金額", { positive: true }), isEstimate: boolStr(), calcNote: optStr(300) }), ({ orderId, ...i }, ctx) => tx(ctx, (t) => addOrderCost(t, orderId, i, ctx.actor)).then(() => ({ message: "已新增訂單直接成本" }))),
  "order.trace": op(z.object({ orderId: docId("訂單") }), (i, ctx) => traceOrder(ctx.db, i.orderId)),
  "customer.save": op(z.object({ id: optDocId(), name: reqStr("顧客名稱", 100), phone: optStr(50), email: optEmail(), address: optStr(500), note: optStr() }), ({ id, ...d }, ctx) =>
    tx(ctx, async (t) => upsert(t, C.customers, id, id ? d : { ...d, code: await import("./domain/core").then((m) => m.nextNumber(t, "C", { daily: false, pad: 4 })) }, ctx.actor, { label: "顧客" })),
  ),

  // ── 報表 ──
  "report.monthly": op(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }), (i, ctx) => monthlyReport(ctx.db, i.month)),
  "report.sku": op(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }), (i, ctx) => skuPerformance(ctx.db, i.month)),
  "report.loss": op(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }), (i, ctx) => lossStats(ctx.db, i.month)),
  "cost.addPeriod": op(z.object({ amount: reqDec("金額", { positive: true }), occurredOn: isoDate("日期"), isEstimate: boolStr(), calcNote: reqStr("項目說明", 300) }), (i, ctx) =>
    tx(ctx, async (t) => {
      const c = t.create(C.costs, { ...i, category: "OPERATING_EXPENSE", target: "PERIOD", roastBatchId: null, productionOrderId: null, orderId: null, note: null, createdAt: nowIso() });
      audit(t, ctx.actor, "cost.period", "CostEntry", c.id, `營運費用 ${i.amount}：${i.calcNote}`);
      return { message: "已新增期間營運費用" };
    }),
  ),
  "cost.addRule": op(z.object({ name: reqStr("規則名稱", 100), category: reqStr("類別", 40), method: z.enum(["PER_BATCH", "PER_KG_GREEN", "PER_UNIT", "PERCENT_OF_REVENUE"]), rate: reqDec("費率", { min: 0 }), description: optStr(500) }), (i, ctx) => tx(ctx, (t) => upsert(t, C.costRules, null, { ...i, isActive: true }, ctx.actor, { label: "成本分攤規則" })).then(() => ({ message: "已新增成本分攤規則" }))),

  // ── 品牌與履歷 ──
  "series.save": op(z.object({ id: optDocId(), code: optStr(40), name: reqStr("系列名稱", 100), story: optStr(), flavorNotes: optStr(), character: z.enum(["NONE", "ATI", "ATO", "BOTH"]), isLimited: bool(), launchDate: optIsoDate(), recommendedRecipeId: optDocId() }), ({ id, ...d }, ctx) => tx(ctx, (t) => upsert(t, C.series, id, d, ctx.actor, { unique: "code", label: "品牌系列" }))),
  "trace.setPublished": op(z.object({ id: docId("履歷"), publish: z.boolean(), recommendedBrew: optStr(300) }), (i, ctx) => tx(ctx, (t) => setTracePublished(t, i.id, i.publish, i.recommendedBrew, ctx.actor))),
  "brand.register": op(z.object({ kind: z.enum(["LOGO", "MASCOT_ATI", "MASCOT_ATO", "PACKAGING", "OTHER"]), name: reqStr("名稱", 100), storagePath: reqStr("檔案", 500), isOfficial: z.boolean(), note: optStr(500) }), (i, ctx) => tx(ctx, (t) => upsert(t, C.brandAssets, null, i, ctx.actor, { label: "品牌素材" })).then(() => ({ message: "已上傳" }))),

  // ── 主檔設定 ──
  "supplier.save": op(z.object({ id: optDocId(), code: optStr(40), name: reqStr("名稱"), contact: optStr(100), phone: optStr(50), email: optStr(200), country: optStr(100), note: optStr() }), ({ id, ...d }, ctx) => tx(ctx, (t) => upsert(t, C.suppliers, id, { ...d, isActive: true }, ctx.actor, { unique: "code", label: "供應商" }))),
  "roaster.save": op(
    z.object({ id: optDocId(), name: reqStr("名稱"), brand: reqStr("品牌"), model: reqStr("型號"), maxCapacityG: optDec("最大容量", { min: 0 }), tempChannels: optStr(200), heatControl: optStr(200), airflowControl: optStr(200), drumSpeedControl: optStr(200), sensorNote: optStr(500), note: optStr() }),
    ({ id, tempChannels, ...d }, ctx) => tx(ctx, (t) => upsert(t, C.roasters, id, { ...d, tempChannels: (tempChannels ?? "").split(/[,，\s]+/).filter(Boolean), isActive: true }, ctx.actor, { unique: "name", label: "烘豆機" })),
  ),
  "equipment.save": op(z.object({ id: optDocId(), type: z.enum(["GRINDER", "DRIPPER", "FILTER", "KETTLE", "SCALE", "OTHER"]), name: reqStr("名稱"), brand: optStr(100), model: optStr(100), note: optStr() }), ({ id, ...d }, ctx) => tx(ctx, (t) => upsert(t, C.equipment, id, { ...d, isActive: true }, ctx.actor, { label: "器材" }))),
  "flavor.save": op(z.object({ id: optDocId(), name: reqStr("詞彙", 50), category: optStr(50) }), ({ id, ...d }, ctx) => tx(ctx, (t) => upsert(t, C.flavorTags, id, d, ctx.actor, { unique: "name", label: "風味詞彙" }))),
  "template.create": op(
    z.object({ name: reqStr("模板名稱"), description: optStr(), scaleMin: reqDec("最低分", { min: 0 }), scaleMax: reqDec("最高分", { positive: true }), step: reqDec("間距", { positive: true }), attributes: reqStr("評分項目", 2000), isDefault: boolStr() }),
    (i, ctx) =>
      tx(ctx, async (t) => {
        const attrs = i.attributes.split("\n").map((l) => l.split(/[:：]/).map((x) => x.trim())).filter((p) => p[0]).map(([key, label]) => ({ key: key.replace(/[^a-zA-Z0-9_]/g, "") || "attr", label: label || key }));
        if (new Set(attrs.map((a) => a.key)).size !== attrs.length || attrs.some((a) => a.key === "attr")) throw new DomainError("評分項目代碼需為英數字且不可重複（格式：代碼:名稱）");
        if (i.isDefault) for (const o of await t.query(C.cuppingTemplates, [["isDefault", "==", true]])) await t.update(C.cuppingTemplates, o.id, { isDefault: false });
        return upsert(t, C.cuppingTemplates, null, { ...i, attributes: attrs }, ctx.actor, { unique: "name", label: "評分模板" });
      }),
  ),
  /** 刪除主檔（供應商、烘豆機、器材、風味詞彙、儲位、顧客、系列、商品、品項、包材、評分模板、配方、咖啡豆、分攤規則）；仍被使用時拒絕 */
  "master.delete": op(z.object({ col: z.enum(Object.keys(DELETABLE) as [string, ...string[]]), id: docId("資料") }), (i, ctx) =>
    tx(ctx, (t) => deleteMaster(t, i.col, i.id, ctx.actor)).then(() => ({ message: `已刪除${DELETABLE[i.col].label}` })),
  ),
  "cost.delete": op(id, ({ id }, ctx) => tx(ctx, (t) => deleteCostEntry(t, id, ctx.actor)).then(() => ({ message: "已刪除營運費用" }))),
  /** 修改評分模板的名稱、說明、預設（評分項目不可改，避免舊杯測分數失真） */
  "template.update": op(z.object({ id: docId("評分模板"), name: reqStr("模板名稱"), description: optStr(), isDefault: boolStr() }), ({ id, ...i }, ctx) =>
    tx(ctx, async (t) => {
      if (i.isDefault) for (const o of await t.query(C.cuppingTemplates, [["isDefault", "==", true]])) if (o.id !== id) await t.update(C.cuppingTemplates, o.id, { isDefault: false });
      await upsert(t, C.cuppingTemplates, id, i, ctx.actor, { unique: "name", label: "評分模板" });
      return { message: "已更新評分模板" };
    }),
  ),
  "material.save": op(z.object({ id: optDocId(), code: optStr(40), name: reqStr("名稱"), category: z.enum(["BAG", "LABEL", "DRIP_BAG", "BOX", "SEAL", "OTHER"]), spec: optStr(200), note: optStr() }), ({ id, ...d }, ctx) => tx(ctx, (t) => upsert(t, C.materials, id, { ...d, isActive: true }, ctx.actor, { unique: "code", label: "包材" }))),
  "location.save": op(z.object({ id: optDocId(), code: optStr(40), name: reqStr("名稱"), note: optStr() }), ({ id, ...d }, ctx) => tx(ctx, (t) => upsert(t, C.locations, id, d, ctx.actor, { unique: "code", label: "儲位" }))),
  "settings.save": op(
    z.object({ taxMode: z.enum(["INCLUSIVE", "EXCLUSIVE", "NONE"]), taxRate: reqDec("稅率", { min: 0 }), requirePaymentBeforeShip: z.enum(["true", "false"]), lowGreenG: reqDec("生豆預警", { min: 0 }), lowRoastedG: reqDec("熟豆預警", { min: 0 }), lowFinishedPcs: reqDec("成品預警", { min: 0 }), expiryWarnDays: reqDec("到期提醒天數", { min: 0 }) }),
    (i, ctx) =>
      tx(ctx, async (t) => {
        if (D(i.taxRate).gte(1)) throw new DomainError("稅率請以小數表示，例如 5% 填 0.05");
        t.set(C.settings, "tax", { mode: i.taxMode, rate: i.taxRate });
        t.set(C.settings, "order", { requirePaymentBeforeShip: i.requirePaymentBeforeShip === "true" });
        t.set(C.settings, "inventory", { lowGreenG: Number(i.lowGreenG), lowRoastedG: Number(i.lowRoastedG), lowFinishedPcs: Number(i.lowFinishedPcs), expiryWarnDays: Number(i.expiryWarnDays) });
        audit(t, ctx.actor, "settings.update", "Settings", null, "更新系統預設值", i);
        return { message: "已更新系統預設值（僅影響新交易）" };
      }),
  ),
  "settings.get": op(z.object({}), async (_i, ctx) => runTx(ctx.db, async (t) => (await import("./domain/core")).getSettings(t)).catch(() => DEFAULT_SETTINGS)),
  "apikey.create": op(z.object({ name: reqStr("名稱", 100) }), async (i, ctx) => ({ message: `API 金鑰（只會顯示這一次，請立即存入官網伺服器環境變數）：\n${await tx(ctx, (t) => createApiKey(t, i.name, ctx.actor))}` })),
  "apikey.revoke": op(z.object({ id: docId("金鑰") }), (i, ctx) =>
    tx(ctx, async (t) => {
      await t.update(C.apiKeys, i.id, { revokedAt: nowIso() });
      audit(t, ctx.actor, "apikey.revoke", "ApiKey", i.id, "撤銷 API 金鑰");
      return { message: "已撤銷" };
    }),
  ),
  "admin.add": op(z.object({ uid: reqStr("使用者 UID", 128), email: reqStr("Email", 200), name: reqStr("名稱", 100) }), (i, ctx) =>
    tx(ctx, async (t) => {
      t.set(C.admins, i.uid, { email: i.email, name: i.name, role: "ADMIN", createdAt: nowIso() });
      audit(t, ctx.actor, "admin.add", "Admin", i.uid, `新增管理員 ${i.email}`);
      return { message: "已新增管理員" };
    }),
  ),
  ...STORE_ADMIN_OPS,
};

export type OpName = keyof typeof OPS;

function parseCurveFile(buf: Buffer, fileName: string, mapping: ColumnMapping | null, unit: "C" | "F") {
  if (buf.includes(0)) throw new DomainError("曲線檔應為純文字檔");
  const text = buf.toString("utf8");
  if (fileName.toLowerCase().endsWith(".alog")) {
    const parsed = parseArtisanAlog(text);
    return { format: "ARTISAN_ALOG" as const, mapping: null, parsed, summary: { format: "ARTISAN_ALOG", headers: [] as string[], mapping: {}, pointCount: parsed.points.length, sample: parsed.points.slice(0, 8), events: parsed.events, rorComputed: parsed.rorComputed, warnings: parsed.warnings } };
  }
  const { headers } = preprocessCsv(text);
  const m = mapping && Object.keys(mapping).length ? mapping : detectMapping(headers);
  const parsed = parseCsvCurve(text, m, unit);
  return { format: "CSV" as const, mapping: m, parsed, summary: { format: "CSV", headers, mapping: m, pointCount: parsed.points.length, sample: parsed.points.slice(0, 8), events: parsed.events, rorComputed: parsed.rorComputed, warnings: parsed.warnings } };
}

/** 執行操作：驗證輸入後呼叫 */
export async function runOp(name: string, raw: unknown, ctx: OpCtx) {
  const def = (OPS as unknown as Record<string, Op<z.ZodTypeAny>>)[name];
  if (!def) throw new DomainError(`未知的操作 ${name}`, "NOT_FOUND", 404);
  const force = !!raw && typeof raw === "object" && (raw as Record<string, unknown>).force === true;
  const parsed = def.schema.safeParse(raw ?? {});
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const iss of parsed.error.issues) fieldErrors[iss.path.join(".")] ??= iss.message;
    const e = new DomainError("輸入資料有誤，請檢查標示欄位", "INVALID_ARGUMENT", 400);
    Object.assign(e, { fieldErrors });
    throw e;
  }
  const { result, warnings } = await withSoft(force, () => def.run(parsed.data, ctx));
  // 業務操作完成後的即時通知（盡力而為，失敗不影響操作結果）
  await notifyAfterOp(ctx, name, parsed.data as Record<string, unknown>, result);
  if (!warnings.length) return result;
  if (result && typeof result === "object" && !Array.isArray(result)) return { ...(result as object), warnings };
  return result == null ? { warnings } : result;
}
