/**
 * 示範資料（Demo Seed）— 僅供開發／展示／測試。
 * 安全機制：APP_ENV=production 時拒絕執行；資料庫已有資料時拒絕執行（避免污染）。
 * 所有庫存資料皆透過 Domain Service 建立，帳本與餘額一致。
 *
 * 示範管理員帳號：admin@ata.local
 * 示範密碼：取自環境變數 SEED_ADMIN_PASSWORD，未設定時為 ata-demo-2026（僅限本機示範）
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { withTx } from "../src/lib/db";
import type { Actor } from "../src/server/domain/audit";
import { receiveGreenPurchase } from "../src/server/domain/green";
import { createRoastBatch } from "../src/server/domain/roasting";
import { completeProductionOrder, createProductionOrder } from "../src/server/domain/production";
import { createLot, ensureMaterialItem, post, manualAdjust } from "../src/server/domain/inventory";
import { confirmPayment, createOrder, createReturn, shipOrder, completeOrder, markPaymentPending } from "../src/server/domain/orders";
import { saveCurve } from "../src/server/curves/import";
import { withComputedRor, type CurvePoint } from "../src/server/curves/parse";
import { restDays } from "../src/lib/time";

const prisma = new PrismaClient();

if (process.env.APP_ENV === "production") {
  console.error("拒絕執行：正式環境（APP_ENV=production）不可注入示範資料。");
  process.exit(1);
}

const day = (n: number, hour = 10) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour - 8, 0, 0, 0);
  return d;
};
const dateOnly = (n: number) => new Date(day(n).toISOString().slice(0, 10) + "T00:00:00Z");

async function main() {
  if ((await prisma.user.count()) > 0) {
    console.log("資料庫已有資料，略過 Seed。若要重建請先清空開發資料庫（npm run db:reset-dev）。");
    return;
  }
  const admin = await prisma.user.create({
    data: { email: "admin@ata.local", name: "ATA 管理員", passwordHash: await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD ?? "ata-demo-2026", 12), role: "ADMIN" },
  });
  const actor: Actor = { userId: admin.id };

  // ── 主檔 ──
  const [s1, s2] = await Promise.all([
    prisma.supplier.create({ data: { code: "SUP-001", name: "示範生豆商 A", country: "臺灣", contact: "王先生", note: "示範資料" } }),
    prisma.supplier.create({ data: { code: "SUP-002", name: "示範生豆商 B", country: "臺灣", note: "示範資料" } }),
  ]);
  const [locA, locB] = await Promise.all([
    prisma.inventoryLocation.create({ data: { code: "WH-A", name: "生豆倉（恆溫櫃）" } }),
    prisma.inventoryLocation.create({ data: { code: "WH-B", name: "成品架" } }),
  ]);
  const coffees = await Promise.all(
    [
      { code: "ETH-YRG-W", nameZh: "衣索比亞 耶加雪菲 水洗", nameEn: "Ethiopia Yirgacheffe Washed", country: "衣索比亞", region: "耶加雪菲", producer: "示範合作社", variety: "原生種", process: "水洗", altitude: "1900-2100m", grade: "G1", originFlavorNotes: "茉莉花、檸檬、紅茶", supplierId: s1.id, restStartDays: 5, peakFromDays: 7, peakToDays: 30, shelfLifeDays: 180 },
      { code: "KEN-AA", nameZh: "肯亞 AA", nameEn: "Kenya AA", country: "肯亞", region: "涅里", variety: "SL28, SL34", process: "水洗", altitude: "1700m", grade: "AA", originFlavorNotes: "黑醋栗、番茄、莓果", supplierId: s1.id, restStartDays: 7, peakFromDays: 10, peakToDays: 35, shelfLifeDays: 180 },
      { code: "COL-HUI", nameZh: "哥倫比亞 薇拉", nameEn: "Colombia Huila", country: "哥倫比亞", region: "薇拉", variety: "卡杜拉", process: "水洗", altitude: "1750m", grade: "Supremo", originFlavorNotes: "焦糖、紅蘋果、可可", supplierId: s2.id, restStartDays: 4, peakFromDays: 6, peakToDays: 28, shelfLifeDays: 180 },
      { code: "GTM-ANT", nameZh: "瓜地馬拉 安提瓜", nameEn: "Guatemala Antigua", country: "瓜地馬拉", region: "安提瓜", variety: "波旁", process: "日曬", altitude: "1600m", grade: "SHB", originFlavorNotes: "黑巧克力、葡萄乾、堅果", supplierId: s2.id, restStartDays: 5, peakFromDays: 7, peakToDays: 30, shelfLifeDays: 180 },
    ].map((c) => prisma.coffee.create({ data: { ...c, note: "示範資料" } })),
  );
  const roaster = await prisma.roasterProfile.create({
    data: { name: "Olomo（示範設定）", brand: "Olomo", model: "請填入實際型號", maxCapacityG: 1000, tempChannels: ["BT", "ET"], heatControl: "火力百分比", airflowControl: "風門段數", drumSpeedControl: "固定", note: "示範設定；感測器與通道請依實機調整" },
  });
  const eq = await Promise.all(
    [
      { type: "GRINDER" as const, name: "示範磨豆機", brand: "示範" },
      { type: "DRIPPER" as const, name: "V 型濾杯 02", brand: "示範" },
      { type: "DRIPPER" as const, name: "平底濾杯 185", brand: "示範" },
      { type: "FILTER" as const, name: "V 型濾紙 02", brand: "示範" },
    ].map((e) => prisma.equipment.create({ data: e })),
  );
  const tagNames = [["茉莉花", "花香"], ["柑橘", "果酸"], ["檸檬", "果酸"], ["莓果", "果香"], ["紅茶", "茶感"], ["焦糖", "甜感"], ["可可", "巧克力"], ["黑巧克力", "巧克力"], ["堅果", "堅果"], ["蜂蜜", "甜感"]];
  const tags = await Promise.all(tagNames.map(([name, category]) => prisma.flavorTag.create({ data: { name, category } })));
  const template = await prisma.cuppingTemplate.create({
    data: {
      name: "ATA 自訂杯測（10 分制）",
      description: "ATA Coffee 內部自訂評分系統，非 SCA 官方杯測表。",
      scaleMin: 0,
      scaleMax: 10,
      step: 0.25,
      isDefault: true,
      attributes: [
        { key: "fragrance", label: "乾香" },
        { key: "aroma", label: "濕香" },
        { key: "acidity", label: "酸質" },
        { key: "sweetness", label: "甜感" },
        { key: "body", label: "醇厚度" },
        { key: "balance", label: "平衡" },
        { key: "aftertaste", label: "尾韻" },
        { key: "overall", label: "整體評價" },
      ],
    },
  });

  // ── 包材 ──
  const mats = await Promise.all(
    [
      { code: "BAG-100", name: "100g 單向閥夾鏈袋", category: "BAG" as const, cost: 6, qty: 300 },
      { code: "BAG-200", name: "200g 單向閥夾鏈袋", category: "BAG" as const, cost: 8, qty: 200 },
      { code: "LBL-STD", name: "商品標籤", category: "LABEL" as const, cost: 1.5, qty: 800 },
      { code: "DRIP-FLT", name: "濾掛濾袋", category: "DRIP_BAG" as const, cost: 1.2, qty: 500 },
      { code: "DRIP-ENV", name: "濾掛外袋", category: "BAG" as const, cost: 1.8, qty: 500 },
      { code: "BOX-GIFT", name: "禮盒紙盒", category: "BOX" as const, cost: 35, qty: 30 },
    ].map(async (m) => {
      const material = await prisma.material.create({ data: { code: m.code, name: m.name, category: m.category } });
      await withTx(async (tx) => {
        const item = await ensureMaterialItem(tx, material.id);
        await tx.inventoryItem.update({ where: { id: item.id }, data: { lowStockThreshold: m.qty / 5 } });
        const lot = await createLot(tx, { itemId: item.id, lotCode: `${m.code}-${day(40).toISOString().slice(0, 10).replaceAll("-", "")}`, unitCost: m.cost, locationId: locB.id, producedAt: day(40) });
        await post(tx, { lotId: lot.id, type: "RECEIPT", quantity: m.qty, actor, occurredAt: day(40), note: "包材入庫（示範）" });
      });
      return material;
    }),
  );
  const mat = Object.fromEntries(mats.map((m) => [m.code, m]));

  // ── 品牌系列 ──
  const recipe = await prisma.brewRecipe.create({
    data: { name: "ATA 標準手沖", coffeeId: coffees[0].id, isRecommended: true, grinderId: eq[0].id, grindSetting: "24 格", dripperId: eq[1].id, filterId: eq[3].id, doseG: 15, waterG: 240, waterTempC: 92, bloomWaterG: 40, bloomTimeSec: 35, totalTimeSec: 150, pourMethod: "三段式注水", agitation: "悶蒸後輕搖", pourPlan: [{ stepNo: 1, startSec: 0, endSec: 10, waterG: 40 }, { stepNo: 2, startSec: 35, endSec: 60, waterG: 100 }, { stepNo: 3, startSec: 75, endSec: 100, waterG: 100 }] },
  });
  const series = await Promise.all([
    prisma.brandSeries.create({ data: { code: "ATA 001", name: "晨光", story: "示範故事：一天開始的第一杯。", flavorNotes: "花香、柑橘、紅茶", launchDate: dateOnly(120), recommendedRecipeId: recipe.id } }),
    prisma.brandSeries.create({ data: { code: "ATA 002", name: "午後", story: "示範故事：午後的溫暖甜感。", flavorNotes: "焦糖、可可、紅蘋果", launchDate: dateOnly(60) } }),
    prisma.brandSeries.create({ data: { code: "ATI-SP", name: "Ati 特別版", character: "ATI", isLimited: true, story: "示範：Ati 角色限定款（角色圖像待上傳官方素材）", launchDate: dateOnly(20) } }),
  ]);

  // ── 商品 ──
  const mkProduct = async (p: { code: string; name: string; category: "COFFEE_BEAN" | "DRIP_BAG" | "DRIP_BAG_SET" | "GIFT_BOX"; coffeeId?: string; seriesId?: string; isLimited?: boolean; flavorNotes?: string }) =>
    prisma.product.create({ data: { code: p.code, name: p.name, category: p.category, coffeeId: p.coffeeId, brandSeriesId: p.seriesId, isLimited: p.isLimited ?? false, status: "ACTIVE", flavorNotes: p.flavorNotes, description: "示範商品" } });
  const pYrg = await mkProduct({ code: "ATA001-YRG", name: "ATA 001 晨光｜耶加雪菲", category: "COFFEE_BEAN", coffeeId: coffees[0].id, seriesId: series[0].id, flavorNotes: "茉莉花、檸檬、紅茶" });
  const pCol = await mkProduct({ code: "ATA002-COL", name: "ATA 002 午後｜哥倫比亞", category: "COFFEE_BEAN", coffeeId: coffees[2].id, seriesId: series[1].id, flavorNotes: "焦糖、紅蘋果、可可" });
  const pDrip = await mkProduct({ code: "DRIP-YRG", name: "晨光濾掛｜耶加雪菲", category: "DRIP_BAG", coffeeId: coffees[0].id, seriesId: series[0].id });
  const pSet = await mkProduct({ code: "DRIP-SET5", name: "晨光濾掛 5 入組", category: "DRIP_BAG_SET", seriesId: series[0].id });
  const pGift = await mkProduct({ code: "GIFT-ATI", name: "Ati 特別版禮盒", category: "GIFT_BOX", seriesId: series[2].id, isLimited: true });

  const bomBean100 = [{ materialId: mat["BAG-100"].id, quantityPerUnit: 1 }, { materialId: mat["LBL-STD"].id, quantityPerUnit: 1 }];
  const bomBean200 = [{ materialId: mat["BAG-200"].id, quantityPerUnit: 1 }, { materialId: mat["LBL-STD"].id, quantityPerUnit: 1 }];
  const bomDrip = [{ materialId: mat["DRIP-FLT"].id, quantityPerUnit: 1 }, { materialId: mat["DRIP-ENV"].id, quantityPerUnit: 1 }];
  const v = {
    yrg100: await prisma.productVariant.create({ data: { productId: pYrg.id, sku: "ATA001-YRG-100", name: "100g 咖啡豆", listPrice: 450, salePrice: 420, standardCost: 120, fillWeightG: 100, stockPolicy: "MADE_TO_ORDER", materials: { create: bomBean100 } } }),
    yrg200: await prisma.productVariant.create({ data: { productId: pYrg.id, sku: "ATA001-YRG-200", name: "200g 咖啡豆", listPrice: 820, salePrice: 780, standardCost: 230, fillWeightG: 200, stockPolicy: "MADE_TO_ORDER", materials: { create: bomBean200 } } }),
    col100: await prisma.productVariant.create({ data: { productId: pCol.id, sku: "ATA002-COL-100", name: "100g 咖啡豆", listPrice: 400, salePrice: 380, standardCost: 100, fillWeightG: 100, stockPolicy: "STOCK_ONLY", materials: { create: bomBean100 } } }),
    drip1: await prisma.productVariant.create({ data: { productId: pDrip.id, sku: "DRIP-YRG-1", name: "單包濾掛 11g", listPrice: 45, salePrice: 40, standardCost: 15, fillWeightG: 11, stockPolicy: "STOCK_ONLY", materials: { create: bomDrip } } }),
  };
  const set5 = await prisma.productVariant.create({ data: { productId: pSet.id, sku: "DRIP-SET-5", name: "濾掛 5 入", listPrice: 220, salePrice: 190, isBundle: true, stockPolicy: "STOCK_ONLY", bundleComponents: { create: [{ componentVariantId: v.drip1.id, quantity: 5 }] } } });
  const gift = await prisma.productVariant.create({ data: { productId: pGift.id, sku: "GIFT-ATI-01", name: "禮盒（100g + 濾掛 3 入）", listPrice: 680, salePrice: 640, isBundle: true, stockPolicy: "STOCK_ONLY", bundleComponents: { create: [{ componentVariantId: v.yrg100.id, quantity: 1 }, { componentVariantId: v.drip1.id, quantity: 3 }] } } });
  void gift;

  // ── 生豆採購 ──
  const greens: Awaited<ReturnType<typeof receiveGreenPurchase>>[] = [];
  for (const [i, c] of coffees.entries()) {
    greens.push(
      await withTx((tx) =>
        receiveGreenPurchase(
          tx,
          { coffeeId: c.id, supplierId: c.supplierId, purchaseDate: dateOnly(60 - i), receivedAt: day(58 - i), purchasedWeightG: 10000, receivedWeightG: 9980 - i * 5, unitPricePerKg: [720, 850, 560, 600][i], shippingCost: 350, otherCost: 0, moisturePercent: 10.5 + i * 0.3, densityGPerL: 700 + i * 8, locationId: locA.id, invoiceNo: `INV-DEMO-${i + 1}` },
          actor,
        ),
      ),
    );
  }

  // ── 烘焙 ──
  const roastPlan = [
    { g: 0, ago: 28, green: 800, roasted: 682, dry: 270, fc: 495, drop: 600, level: "淺焙" },
    { g: 2, ago: 25, green: 900, roasted: 765, dry: 260, fc: 480, drop: 590, level: "中焙" },
    { g: 0, ago: 18, green: 800, roasted: 680, dry: 265, fc: 490, drop: 598, level: "淺焙" },
    { g: 1, ago: 14, green: 700, roasted: 598, dry: 280, fc: 505, drop: 610, level: "淺中焙" },
    { g: 3, ago: 10, green: 900, roasted: 760, dry: 255, fc: 470, drop: 585, level: "中深焙" },
    { g: 0, ago: 6, green: 900, roasted: 768, dry: 268, fc: 492, drop: 601, level: "淺焙" },
    { g: 2, ago: 3, green: 900, roasted: 767, dry: 258, fc: 478, drop: 588, level: "中焙" },
  ];
  const roasts: Awaited<ReturnType<typeof createRoastBatch>>[] = [];
  for (const [i, r] of roastPlan.entries()) {
    const res = await withTx((tx) =>
      createRoastBatch(
        tx,
        {
          greenLotId: greens[r.g].greenLot.id,
          roasterId: roaster.id,
          roastedAt: day(r.ago, 14),
          greenWeightG: r.green,
          roastedWeightG: r.roasted,
          chargeTempC: 205,
          turningPointSec: 75,
          turningPointTempC: 92,
          dryEndSec: r.dry,
          firstCrackStartSec: r.fc,
          dropSec: r.drop,
          dropTempC: 196 + i,
          roastLevel: r.level,
          targetProfile: "保留花香與酸質",
          result: "示範紀錄",
          qualityRating: 7 + (i % 3),
          extraCosts: [
            { category: "ROAST_ENERGY", amount: 18, isEstimate: true, calcNote: "估計：約 1.2 度電 × NT$4.5 + 瓦斯" },
            { category: "ROAST_LABOR", amount: 50, isEstimate: true, calcNote: "估計：20 分鐘 × NT$150/時" },
          ],
        },
        actor,
      ),
    );
    roasts.push(res);
    // 合成示範曲線（明確標示為示範資料，非實機紀錄）
    const pts: CurvePoint[] = [];
    for (let t = 0; t <= r.drop; t += 5) {
      const bt = t < 75 ? 205 - (205 - 92) * (t / 75) : 92 + (196 + i - 92) * Math.pow((t - 75) / (r.drop - 75), 0.8);
      pts.push({ timeSec: t, btC: Math.round(bt * 10) / 10, etC: Math.round((215 + Math.sin(t / 90) * 8 + t * 0.02) * 10) / 10, rorC: null, heat: t < r.fc ? 80 : 60, airflow: t < r.dry ? 2 : 3, drumSpeed: null });
    }
    await withTx((tx) =>
      saveCurve(tx, { roastBatchId: res.batch.id, source: "MANUAL", fileName: "示範合成曲線（非實機資料）", parsed: { points: withComputedRor(pts), events: [], rorComputed: true, warnings: [] } }, actor),
    );
  }

  // ── 杯測與手沖 ──
  for (const [i, r] of roasts.entries()) {
    for (const offset of [3, 8]) {
      const at = new Date(r.batch.roastedAt.getTime() + offset * 86400_000);
      if (at > new Date()) continue;
      const base = 7 + (i % 3) * 0.25 + (offset > 5 ? 0.25 : 0);
      const scores = (template.attributes as Array<{ key: string; label: string }>).map((a, k) => ({ attributeKey: a.key, label: a.label, score: Math.min(10, base + ((k * 7) % 5) * 0.25) }));
      await withTx(async (tx) => {
        await tx.cuppingSession.create({
          data: {
            roastBatchId: r.batch.id,
            templateId: template.id,
            cuppedAt: at,
            restDays: restDays(r.batch.roastedAt, at),
            grindSetting: "中粗",
            doseG: 8.25,
            waterG: 150,
            waterTempC: 93,
            totalScore: scores.reduce((s, x) => s + x.score, 0) / scores.length,
            evaluator: "ATA 管理員",
            description: offset > 5 ? "風味較為開展（示範）" : "仍偏緊縮（示範）",
            consumedG: 16.5,
            scores: { create: scores },
            tags: { create: [tags[i % tags.length], tags[(i + 3) % tags.length]].map((t) => ({ flavorTagId: t.id })) },
          },
        });
        const lot = await tx.inventoryLot.findUniqueOrThrow({ where: { roastBatchId: r.batch.id } });
        await manualAdjust(tx, { lotId: lot.id, type: "CUPPING_USE", quantity: -16.5, actor, note: "杯測耗用" });
      });
    }
    const brewAt = new Date(r.batch.roastedAt.getTime() + 7 * 86400_000);
    if (brewAt < new Date()) {
      await prisma.brewSession.create({
        data: {
          roastBatchId: r.batch.id,
          recipeId: recipe.id,
          brewedAt: brewAt,
          restDays: 7,
          grinderId: eq[0].id,
          grindSetting: `${23 + (i % 3)} 格`,
          dripperId: eq[1].id,
          filterId: eq[3].id,
          doseG: 15,
          waterG: 240,
          ratio: 16,
          waterTempC: 91 + (i % 3),
          waterQuality: "RO + 礦物質（示範）",
          totalTimeSec: 145 + i * 3,
          bloomTimeSec: 35,
          bloomWaterG: 40,
          pourMethod: "三段式注水",
          rating: 7 + (i % 3) * 0.5,
          flavorNotes: "示範：甜感明顯，尾韻乾淨",
          pourSteps: { create: [{ stepNo: 1, startSec: 0, endSec: 10, waterG: 40, cumulativeG: 40 }, { stepNo: 2, startSec: 35, endSec: 60, waterG: 100, cumulativeG: 140 }, { stepNo: 3, startSec: 75, endSec: 100, waterG: 100, cumulativeG: 240 }] },
        },
      });
    }
  }

  // ── 研究專案 ──
  await prisma.researchProject.create({
    data: {
      code: "RP-001",
      name: "耶加雪菲發展時間比例對花香的影響（示範）",
      hypothesis: "DTR 由 18% 提升至 21% 可能降低花香、提升甜感。",
      objective: "比較不同 DTR 下的杯測與手沖結果",
      controlledVariables: "同一生豆批次、同一投入量、同一杯測模板",
      independentVariables: "發展時間比例（DTR）",
      status: "RUNNING",
      startDate: dateOnly(30),
      experiments: {
        create: [
          { version: 1, label: "基準組 DTR≈17.5%", isBaseline: true, experimentDate: dateOnly(28), variableValues: { DTR: "17.5%" }, observation: "示範觀察", links: { create: [{ roastBatchId: roasts[0].batch.id }] } },
          { version: 2, label: "實驗組 DTR≈18.4%", experimentDate: dateOnly(6), variableValues: { DTR: "18.4%" }, observation: "示範觀察", links: { create: [{ roastBatchId: roasts[5].batch.id }] } },
        ],
      },
    },
  });

  // ── 分裝 ──
  const pack = (roastIdx: number, variantId: string, qty: number, loss: number, ago: number, fill?: number) =>
    withTx(async (tx) => {
      const po = await createProductionOrder(tx, { sourceLotId: roasts[roastIdx].roastedLot.id, targetVariantId: variantId, plannedQty: qty, fillWeightG: fill, plannedDate: dateOnly(ago) }, actor);
      const res = await completeProductionOrder(tx, po.id, { actualQty: qty, lossG: loss, laborCost: qty * 5, laborIsEstimate: true, completedAt: day(ago, 16) }, actor);
      await tx.productTraceability.update({ where: { packagingBatchId: res.packagingBatch.id }, data: { isPublished: true } });
      return res;
    });
  await pack(0, v.yrg100.id, 5, 4, 24);
  await pack(1, v.col100.id, 6, 5, 22);
  await pack(2, v.yrg100.id, 4, 3, 15);
  await pack(2, v.drip1.id, 20, 6, 15);
  await pack(6, v.col100.id, 4, 3, 2);
  // 規劃中的分裝單
  await withTx((tx) => createProductionOrder(tx, { sourceLotId: roasts[5].roastedLot.id, targetVariantId: v.yrg100.id, plannedQty: 3, plannedDate: dateOnly(-1), note: "下週出貨備貨" }, actor));

  // ── 顧客與訂單 ──
  const customers = await Promise.all(
    [
      { code: "C-0001", name: "示範顧客 林小姐", phone: "0900-000-001", address: "臺北市（示範地址）" },
      { code: "C-0002", name: "示範顧客 陳先生", phone: "0900-000-002", address: "臺中市（示範地址）" },
      { code: "C-0003", name: "示範咖啡館", phone: "02-0000-0003", address: "新北市（示範地址）", note: "批發客戶（示範）" },
    ].map((c) => prisma.customer.create({ data: c })),
  );
  const mkOrder = (cIdx: number, items: Array<{ variantId: string; quantity: number }>, ago: number, shippingFee = 60) =>
    withTx((tx) => createOrder(tx, { customerId: customers[cIdx].id, customerName: customers[cIdx].name, customerPhone: customers[cIdx].phone, shippingAddress: customers[cIdx].address, shippingMethod: "宅配", shippingFee, items, orderedAt: day(ago, 11) }, actor));

  const o1 = await mkOrder(0, [{ variantId: v.yrg100.id, quantity: 2 }], 20);
  await withTx((tx) => confirmPayment(tx, o1.order.id, { reference: "末五碼 00001（示範）", paidAt: day(20, 15) }, actor));
  await withTx((tx) => shipOrder(tx, o1.order.id, { carrier: "示範物流", trackingNo: "DEMO0001", shippingCost: 90, shippedAt: day(19) }, actor));
  await withTx((tx) => completeOrder(tx, o1.order.id, actor));

  const o2 = await mkOrder(2, [{ variantId: v.col100.id, quantity: 3 }, { variantId: set5.id, quantity: 1 }], 12, 0);
  await withTx((tx) => confirmPayment(tx, o2.order.id, { reference: "末五碼 00002（示範）", paidAt: day(12, 15) }, actor));
  await withTx((tx) => shipOrder(tx, o2.order.id, { carrier: "示範物流", trackingNo: "DEMO0002", shippingCost: 120, shippedAt: day(11) }, actor));
  const a2 = await prisma.orderBatchAllocation.findFirstOrThrow({ where: { orderItem: { orderId: o2.order.id, skuSnapshot: "ATA002-COL-100" } } });
  await withTx((tx) => createReturn(tx, o2.order.id, { reason: "包裝受損（示範）", items: [{ allocationId: a2.id, quantity: 1 }] }, actor));

  const o3 = await mkOrder(1, [{ variantId: v.yrg100.id, quantity: 1 }, { variantId: v.drip1.id, quantity: 4 }], 4);
  await withTx((tx) => confirmPayment(tx, o3.order.id, { reference: "末五碼 00003（示範）" }, actor));

  const o4 = await mkOrder(0, [{ variantId: v.yrg200.id, quantity: 1 }], 2); // 接單後分裝
  await withTx((tx) => markPaymentPending(tx, o4.order.id, actor, "顧客回報已匯款（示範）"));

  await mkOrder(1, [{ variantId: v.col100.id, quantity: 1 }], 1); // 未付款

  // 期間營運費用（示範）
  await prisma.costEntry.create({ data: { category: "OPERATING_EXPENSE", target: "PERIOD", amount: 1200, isEstimate: false, occurredOn: dateOnly(5), calcNote: "示範：網站與軟體訂閱" } });
  await prisma.costEntry.create({ data: { category: "PAYMENT_FEE", target: "SALES_ORDER", amount: 15, occurredOn: dateOnly(11), salesOrderId: o2.order.id, calcNote: "示範：匯款手續費" } });

  await prisma.systemSetting.createMany({
    data: [
      { key: "tax", value: { mode: "INCLUSIVE", rate: "0.05" } },
      { key: "order", value: { requirePaymentBeforeShip: true } },
    ],
  });
  console.log("示範資料建立完成。登入帳號 admin@ata.local（密碼見 prisma/seed.ts 註解或 SEED_ADMIN_PASSWORD）");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
