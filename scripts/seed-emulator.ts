/**
 * 示範資料（只寫入 Firebase 模擬器；偵測到非模擬器時拒絕執行）。
 * 所有資料都透過與正式環境相同的業務操作（ops）建立，帳本與餘額一致。
 *
 * 示範管理員：admin@ata.local ／ 密碼 ata-demo-2026（僅存在於本機模擬器）
 */
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { runOp, type OpCtx } from "../functions/src/ops";
import { runTx } from "../functions/src/tx";
import { C } from "../functions/src/types";
import { createCupping, createBrew } from "../functions/src/domain/lab";
import { saveCurve } from "../functions/src/domain/curves";
import { withComputedRor, type CurvePoint } from "../functions/src/curves/parse";
import { toTaipeiLocalInput } from "../src/lib/time";
import { seedStore } from "./seed-store";

if (process.argv.includes("--emulator")) {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
}
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("拒絕執行：示範資料只能寫入 Firebase 模擬器（請用 npm run seed）");
  process.exit(1);
}
const PROJECT = "demo-ata-coffee";
if (!getApps().length) initializeApp({ projectId: PROJECT });
const db = getFirestore();

const daysAgo = (n: number, hour = 10) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour - 8, 0, 0, 0);
  return d;
};
const local = (n: number, h = 10) => toTaipeiLocalInput(daysAgo(n, h));
const ymd = (n: number) => local(n).slice(0, 10);

async function main() {
  if ((await db.collection(C.admins).limit(1).get()).size) {
    console.log("模擬器已有資料，略過 Seed（重新啟動模擬器即可清空）");
    return;
  }
  const auth = getAuth();
  const user = await auth.createUser({ email: "admin@ata.local", password: "ata-demo-2026", displayName: "ATA 管理員", emailVerified: true }).catch(async () => auth.getUserByEmail("admin@ata.local"));
  await db.collection(C.admins).doc(user.uid).set({ email: "admin@ata.local", name: "ATA 管理員", role: "ADMIN", createdAt: new Date().toISOString() });
  await db.collection(C.uniq).doc("first-admin").set({ uid: user.uid, at: new Date().toISOString() });
  const ctx: OpCtx = { db, actor: { userId: user.uid, name: "ATA 管理員" } };
  const op = <T = { id: string }>(name: string, input: unknown) => runOp(name, input, ctx) as Promise<T>;

  const s1 = await op("supplier.save", { code: "SUP-001", name: "示範生豆商 A", country: "臺灣", contact: "王先生", note: "示範資料" });
  const s2 = await op("supplier.save", { code: "SUP-002", name: "示範生豆商 B", country: "臺灣", note: "示範資料" });
  const locA = await op("location.save", { code: "WH-A", name: "生豆倉（恆溫櫃）" });
  await op("location.save", { code: "WH-B", name: "成品架" });
  const coffees: Array<{ id: string }> = [];
  for (const c of [
    { code: "ETH-YRG-W", nameZh: "衣索比亞 耶加雪菲 水洗", nameEn: "Ethiopia Yirgacheffe Washed", country: "衣索比亞", region: "耶加雪菲", producer: "示範合作社", variety: "原生種", process: "水洗", altitude: "1900-2100m", grade: "G1", originFlavorNotes: "茉莉花、檸檬、紅茶", supplierId: s1.id, restStartDays: "5", peakFromDays: "7", peakToDays: "30", shelfLifeDays: "180" },
    { code: "KEN-AA", nameZh: "肯亞 AA", nameEn: "Kenya AA", country: "肯亞", region: "涅里", variety: "SL28, SL34", process: "水洗", altitude: "1700m", grade: "AA", originFlavorNotes: "黑醋栗、番茄、莓果", supplierId: s1.id, restStartDays: "7", peakFromDays: "10", peakToDays: "35", shelfLifeDays: "180" },
    { code: "COL-HUI", nameZh: "哥倫比亞 薇拉", nameEn: "Colombia Huila", country: "哥倫比亞", region: "薇拉", variety: "卡杜拉", process: "水洗", altitude: "1750m", grade: "Supremo", originFlavorNotes: "焦糖、紅蘋果、可可", supplierId: s2.id, restStartDays: "4", peakFromDays: "6", peakToDays: "28", shelfLifeDays: "180" },
    { code: "GTM-ANT", nameZh: "瓜地馬拉 安提瓜", nameEn: "Guatemala Antigua", country: "瓜地馬拉", region: "安提瓜", variety: "波旁", process: "日曬", altitude: "1600m", grade: "SHB", originFlavorNotes: "黑巧克力、葡萄乾、堅果", supplierId: s2.id, restStartDays: "5", peakFromDays: "7", peakToDays: "30", shelfLifeDays: "180" },
  ]) coffees.push(await op("coffee.save", { ...c, note: "示範資料" }));
  const roaster = await op("roaster.save", { name: "Olomo（示範設定）", brand: "Olomo", model: "請填入實際型號", maxCapacityG: "1000", tempChannels: "BT,ET", heatControl: "火力百分比", airflowControl: "風門段數", drumSpeedControl: "固定", note: "示範設定；感測器與通道請依實機調整" });
  const grinder = await op("equipment.save", { type: "GRINDER", name: "示範磨豆機", brand: "示範" });
  const dripper = await op("equipment.save", { type: "DRIPPER", name: "V 型濾杯 02", brand: "示範" });
  await op("equipment.save", { type: "DRIPPER", name: "平底濾杯 185", brand: "示範" });
  const filter = await op("equipment.save", { type: "FILTER", name: "V 型濾紙 02", brand: "示範" });
  for (const [name, category] of [["茉莉花", "花香"], ["柑橘", "果酸"], ["檸檬", "果酸"], ["莓果", "果香"], ["紅茶", "茶感"], ["焦糖", "甜感"], ["可可", "巧克力"], ["黑巧克力", "巧克力"], ["堅果", "堅果"], ["蜂蜜", "甜感"]]) await op("flavor.save", { name, category });
  const tpl = await op("template.create", { name: "ATA 自訂杯測（10 分制）", description: "ATA Coffee 內部自訂評分系統，非 SCA 官方杯測表。", scaleMin: "0", scaleMax: "10", step: "0.25", isDefault: "true", attributes: "fragrance:乾香\naroma:濕香\nacidity:酸質\nsweetness:甜感\nbody:醇厚度\nbalance:平衡\naftertaste:尾韻\noverall:整體評價" });

  const mats: Record<string, string> = {};
  for (const m of [
    { code: "BAG-100", name: "100g 單向閥夾鏈袋", category: "BAG", cost: "6", qty: "300" },
    { code: "BAG-200", name: "200g 單向閥夾鏈袋", category: "BAG", cost: "8", qty: "200" },
    { code: "LBL-STD", name: "商品標籤", category: "LABEL", cost: "1.5", qty: "800" },
    { code: "DRIP-FLT", name: "濾掛濾袋", category: "DRIP_BAG", cost: "1.2", qty: "500" },
    { code: "DRIP-ENV", name: "濾掛外袋", category: "BAG", cost: "1.8", qty: "500" },
    { code: "BOX-GIFT", name: "禮盒紙盒", category: "BOX", cost: "35", qty: "30" },
  ]) {
    const r = await op("material.save", { code: m.code, name: m.name, category: m.category });
    mats[m.code] = r.id;
    await op("inventory.receiveMaterial", { materialId: r.id, quantity: m.qty, unitCost: m.cost, note: "包材入庫（示範）" });
  }

  // 生豆
  const greens = [];
  for (const [i, c] of coffees.entries()) {
    greens.push(await op<{ id: string; lotId: string }>("green.receive", { coffeeId: c.id, supplierId: i < 2 ? s1.id : s2.id, purchaseDate: ymd(60 - i), receivedAt: local(58 - i), purchasedWeightG: "10000", receivedWeightG: String(9980 - i * 5), unitPricePerKg: ["720", "850", "560", "600"][i], shippingCost: "350", moisturePercent: String(10.5 + i * 0.3), densityGPerL: String(700 + i * 8), locationId: locA.id, invoiceNo: `INV-DEMO-${i + 1}` }));
  }
  const tagsRecipe = await (async () => {
    const r = await runTx(db, async (t) => t.create(C.brewRecipes, { name: "ATA 標準手沖", rootId: null, version: 1, coffeeId: coffees[0].id, coffeeName: "衣索比亞 耶加雪菲 水洗", isRecommended: true, grinderId: grinder.id, grinderName: "示範磨豆機", grindSetting: "24 格", dripperId: dripper.id, dripperName: "V 型濾杯 02", filterId: filter.id, filterName: "V 型濾紙 02", doseG: "15.00", waterG: "240.00", waterTempC: "92.0", bloomWaterG: "40.00", bloomTimeSec: 35, totalTimeSec: 150, pourMethod: "三段式注水", agitation: "悶蒸後輕搖", pourPlan: [{ stepNo: 1, startSec: 0, endSec: 10, waterG: "40" }, { stepNo: 2, startSec: 35, endSec: 60, waterG: "100" }, { stepNo: 3, startSec: 75, endSec: 100, waterG: "100" }], note: null, createdAt: new Date().toISOString() }));
    return r;
  })();
  const ser1 = await op("series.save", { code: "ATA 001", name: "晨光", story: "示範故事：一天開始的第一杯。", flavorNotes: "花香、柑橘、紅茶", character: "NONE", launchDate: ymd(120), recommendedRecipeId: tagsRecipe.id });
  const ser2 = await op("series.save", { code: "ATA 002", name: "午後", story: "示範故事：午後的溫暖甜感。", flavorNotes: "焦糖、可可、紅蘋果", character: "NONE", launchDate: ymd(60) });
  const ser3 = await op("series.save", { code: "ATI-SP", name: "Ati 特別版", character: "ATI", isLimited: true, story: "示範：Ati 角色限定款（角色圖像待上傳官方素材）", launchDate: ymd(20) });

  const pYrg = await op("product.save", { code: "ATA001-YRG", name: "ATA 001 晨光｜耶加雪菲", category: "COFFEE_BEAN", coffeeId: coffees[0].id, brandSeriesId: ser1.id, status: "ACTIVE", flavorNotes: "茉莉花、檸檬、紅茶", description: "示範商品" });
  const pCol = await op("product.save", { code: "ATA002-COL", name: "ATA 002 午後｜哥倫比亞", category: "COFFEE_BEAN", coffeeId: coffees[2].id, brandSeriesId: ser2.id, status: "ACTIVE", flavorNotes: "焦糖、紅蘋果、可可", description: "示範商品" });
  const pDrip = await op("product.save", { code: "DRIP-YRG", name: "晨光濾掛｜耶加雪菲", category: "DRIP_BAG", coffeeId: coffees[0].id, brandSeriesId: ser1.id, status: "ACTIVE", description: "示範商品" });
  const pSet = await op("product.save", { code: "DRIP-SET5", name: "晨光濾掛 5 入組", category: "DRIP_BAG_SET", brandSeriesId: ser1.id, status: "ACTIVE", description: "示範商品" });
  const pGift = await op("product.save", { code: "GIFT-ATI", name: "Ati 特別版禮盒", category: "GIFT_BOX", brandSeriesId: ser3.id, status: "ACTIVE", isLimited: true, description: "示範商品" });
  const b100 = [{ materialId: mats["BAG-100"], quantityPerUnit: "1" }, { materialId: mats["LBL-STD"], quantityPerUnit: "1" }];
  const b200 = [{ materialId: mats["BAG-200"], quantityPerUnit: "1" }, { materialId: mats["LBL-STD"], quantityPerUnit: "1" }];
  const bDrip = [{ materialId: mats["DRIP-FLT"], quantityPerUnit: "1" }, { materialId: mats["DRIP-ENV"], quantityPerUnit: "1" }];
  const yrg100 = await op("variant.save", { productId: pYrg.id, sku: "ATA001-YRG-100", name: "100g 咖啡豆", listPrice: "450", salePrice: "420", standardCost: "120", fillWeightG: "100", stockPolicy: "MADE_TO_ORDER", status: "ACTIVE", materials: b100 });
  const yrg200 = await op("variant.save", { productId: pYrg.id, sku: "ATA001-YRG-200", name: "200g 咖啡豆", listPrice: "820", salePrice: "780", standardCost: "230", fillWeightG: "200", stockPolicy: "MADE_TO_ORDER", status: "ACTIVE", materials: b200 });
  const col100 = await op("variant.save", { productId: pCol.id, sku: "ATA002-COL-100", name: "100g 咖啡豆", listPrice: "400", salePrice: "380", standardCost: "100", fillWeightG: "100", stockPolicy: "STOCK_ONLY", status: "ACTIVE", materials: b100 });
  const drip1 = await op("variant.save", { productId: pDrip.id, sku: "DRIP-YRG-1", name: "單包濾掛 11g", listPrice: "45", salePrice: "40", standardCost: "15", fillWeightG: "11", stockPolicy: "STOCK_ONLY", status: "ACTIVE", materials: bDrip });
  const set5 = await op("variant.save", { productId: pSet.id, sku: "DRIP-SET-5", name: "濾掛 5 入", listPrice: "220", salePrice: "190", isBundle: true, stockPolicy: "STOCK_ONLY", status: "ACTIVE", components: [{ componentVariantId: drip1.id, quantity: "5" }] });
  const gift1 = await op("variant.save", { productId: pGift.id, sku: "GIFT-ATI-01", name: "禮盒（100g + 濾掛 3 入）", listPrice: "680", salePrice: "640", isBundle: true, stockPolicy: "STOCK_ONLY", status: "ACTIVE", components: [{ componentVariantId: yrg100.id, quantity: "1" }, { componentVariantId: drip1.id, quantity: "3" }] });

  // 烘焙＋示範曲線＋杯測＋手沖
  const plan = [
    { g: 0, ago: 28, green: 800, roasted: 682, dry: 270, fc: 495, drop: 600, level: "淺焙" },
    { g: 2, ago: 25, green: 900, roasted: 765, dry: 260, fc: 480, drop: 590, level: "中焙" },
    { g: 0, ago: 18, green: 800, roasted: 680, dry: 265, fc: 490, drop: 598, level: "淺焙" },
    { g: 1, ago: 14, green: 700, roasted: 598, dry: 280, fc: 505, drop: 610, level: "淺中焙" },
    { g: 3, ago: 10, green: 900, roasted: 760, dry: 255, fc: 470, drop: 585, level: "中深焙" },
    { g: 0, ago: 6, green: 900, roasted: 768, dry: 268, fc: 492, drop: 601, level: "淺焙" },
    { g: 2, ago: 3, green: 900, roasted: 767, dry: 258, fc: 478, drop: 588, level: "中焙" },
  ];
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const roasts: Array<{ id: string; lotId: string; ago: number }> = [];
  for (const [i, p] of plan.entries()) {
    const r = await op("roast.create", { greenLotId: greens[p.g].id, roasterId: roaster.id, roastedAt: local(p.ago, 14), greenWeightG: String(p.green), roastedWeightG: String(p.roasted), chargeTempC: "205", turningPointSec: "1:15", turningPointTempC: "92", dryEndSec: mmss(p.dry), firstCrackStartSec: mmss(p.fc), dropSec: mmss(p.drop), dropTempC: String(196 + i), roastLevel: p.level, targetProfile: "保留花香與酸質", result: "示範紀錄", qualityRating: String(7 + (i % 3)), energyCost: "18", energyIsEstimate: true, energyNote: "估計：約 1.2 度電 × NT$4.5 + 瓦斯", laborCost: "50", laborIsEstimate: true });
    const b = (await db.collection(C.roastBatches).doc(r.id).get()).data()!;
    roasts.push({ id: r.id, lotId: b.invLotId, ago: p.ago });
    const pts: CurvePoint[] = [];
    for (let t = 0; t <= p.drop; t += 5) {
      const bt = t < 75 ? 205 - (205 - 92) * (t / 75) : 92 + (196 + i - 92) * Math.pow((t - 75) / (p.drop - 75), 0.8);
      pts.push({ timeSec: t, btC: Math.round(bt * 10) / 10, etC: Math.round((215 + Math.sin(t / 90) * 8 + t * 0.02) * 10) / 10, rorC: null, heat: t < p.fc ? 80 : 60, airflow: t < p.dry ? 2 : 3, drumSpeed: null });
    }
    await runTx(db, (t) => saveCurve(t, { roastBatchId: r.id, source: "MANUAL", fileName: "示範合成曲線（非實機資料）", parsed: { points: withComputedRor(pts), events: [], rorComputed: true, warnings: [] } }, ctx.actor));
    for (const off of [3, 8]) {
      if (p.ago - off < 0) continue;
      const base = 7 + (i % 3) * 0.25 + (off > 5 ? 0.25 : 0);
      const keys = ["fragrance", "aroma", "acidity", "sweetness", "body", "balance", "aftertaste", "overall"];
      await runTx(db, (t) => createCupping(t, { roastBatchId: r.id, templateId: tpl.id, cuppedAt: daysAgo(p.ago - off, 15).toISOString(), grindSetting: "中粗", doseG: "8.25", waterG: "150", waterTempC: "93", scores: Object.fromEntries(keys.map((k, kk) => [k, String(Math.min(10, base + ((kk * 7) % 5) * 0.25))])), tags: ["茉莉花、紅茶", "焦糖、可可", "莓果、柑橘"][i % 3], evaluator: "ATA 管理員", description: off > 5 ? "風味較為開展（示範）" : "仍偏緊縮（示範）", consumedG: "16.5", deductStock: true }, ctx.actor));
    }
    if (p.ago >= 7) {
      await runTx(db, (t) => createBrew(t, { roastBatchId: r.id, recipeId: tagsRecipe.id, brewedAt: daysAgo(p.ago - 7, 9).toISOString(), grinderId: grinder.id, grindSetting: `${23 + (i % 3)} 格`, dripperId: dripper.id, filterId: filter.id, doseG: "15", waterG: "240", waterTempC: String(91 + (i % 3)), waterQuality: "RO + 礦物質（示範）", totalTimeSec: 145 + i * 3, bloomTimeSec: 35, bloomWaterG: "40", pourMethod: "三段式注水", rating: String(7 + (i % 3) * 0.5), flavorNotes: "示範：甜感明顯，尾韻乾淨", tags: "焦糖、蜂蜜", pourSteps: [{ startSec: 0, endSec: 10, waterG: "40" }, { startSec: 35, endSec: 60, waterG: "100" }, { startSec: 75, endSec: 100, waterG: "100" }] }, ctx.actor));
    }
  }

  const rp = await op("research.save", { name: "耶加雪菲發展時間比例對花香的影響（示範）", hypothesis: "DTR 由 18% 提升至 21% 可能降低花香、提升甜感。", objective: "比較不同 DTR 下的杯測與手沖結果", controlledVariables: "同一生豆批次、同一投入量、同一杯測模板", independentVariables: "發展時間比例（DTR）", status: "RUNNING", startDate: ymd(30) });
  await op("research.addExperiment", { projectId: rp.id, label: "基準組 DTR≈17.5%", experimentDate: ymd(28), isBaseline: "true", variableValues: "DTR:17.5%", observation: "示範觀察", roastBatchId: roasts[0].id });
  await op("research.addExperiment", { projectId: rp.id, label: "實驗組 DTR≈18.4%", experimentDate: ymd(6), isBaseline: "false", variableValues: "DTR:18.4%", observation: "示範觀察", roastBatchId: roasts[5].id });

  // 分裝
  const pack = async (ri: number, variantId: string, qty: number, loss: number, ago: number) => {
    const po = await op("production.create", { sourceLotId: roasts[ri].lotId, targetVariantId: variantId, plannedQty: String(qty), plannedDate: ymd(ago) });
    await op("production.complete", { id: po.id, actualQty: String(qty), lossG: String(loss), laborCost: String(qty * 5) });
    const pkgId = (await db.collection(C.productionOrders).doc(po.id).get()).data()!.packagingBatchId;
    const tr = await db.collection(C.traces).where("packagingBatchId", "==", pkgId).get();
    await op("trace.setPublished", { id: tr.docs[0].id, publish: true });
  };
  await pack(0, yrg100.id, 5, 4, 24);
  await pack(1, col100.id, 6, 5, 22);
  await pack(2, yrg100.id, 4, 3, 15);
  await pack(2, drip1.id, 20, 6, 15);
  await pack(6, col100.id, 4, 3, 2);
  await op("production.create", { sourceLotId: roasts[5].lotId, targetVariantId: yrg100.id, plannedQty: "3", plannedDate: ymd(-1), note: "下週出貨備貨" });

  // 顧客與訂單
  const cs: Array<{ id: string }> = [];
  for (const c of [
    { name: "示範顧客 林小姐", phone: "0900-000-001", address: "臺北市（示範地址）" },
    { name: "示範顧客 陳先生", phone: "0900-000-002", address: "臺中市（示範地址）" },
    { name: "示範咖啡館", phone: "02-0000-0003", address: "新北市（示範地址）", note: "批發客戶（示範）" },
  ]) cs.push(await op("customer.save", c));
  const mk = (ci: number, items: Array<{ variantId: string; quantity: string }>, fee = "60") => op("order.create", { customerId: cs[ci].id, shippingMethod: "宅配", shippingFee: fee, items });
  const o1 = await mk(0, [{ variantId: yrg100.id, quantity: "2" }]);
  await op("order.confirmPayment", { orderId: o1.id, reference: "末五碼 00001（示範）" });
  await op("order.ship", { orderId: o1.id, carrier: "示範物流", trackingNo: "DEMO0001", shippingCost: "90" });
  await op("order.complete", { orderId: o1.id });
  const o2 = await mk(2, [{ variantId: col100.id, quantity: "3" }, { variantId: set5.id, quantity: "1" }], "0");
  await op("order.confirmPayment", { orderId: o2.id, reference: "末五碼 00002（示範）" });
  await op("order.ship", { orderId: o2.id, carrier: "示範物流", trackingNo: "DEMO0002", shippingCost: "120" });
  const a2 = (await db.collection(C.allocations).where("orderId", "==", o2.id).get()).docs.find((d) => d.data().sku === "ATA002-COL-100")!;
  await op("order.return", { orderId: o2.id, reason: "包裝受損（示範）", items: [{ allocationId: a2.id, quantity: "1" }] });
  await op("order.addCost", { orderId: o2.id, category: "PAYMENT_FEE", amount: "15", isEstimate: "false", calcNote: "示範：匯款手續費" });
  const o3 = await mk(1, [{ variantId: yrg100.id, quantity: "1" }, { variantId: drip1.id, quantity: "4" }]);
  await op("order.confirmPayment", { orderId: o3.id, reference: "末五碼 00003（示範）" });
  const o4 = await mk(0, [{ variantId: yrg200.id, quantity: "1" }]);
  await op("order.markPending", { orderId: o4.id, reference: "顧客回報已匯款（示範）" });
  await mk(1, [{ variantId: col100.id, quantity: "1" }]);
  await op("cost.addPeriod", { amount: "1200", occurredOn: ymd(5), isEstimate: "false", calcNote: "示範：網站與軟體訂閱" });
  await op("settings.save", { taxMode: "INCLUSIVE", taxRate: "0.05", requirePaymentBeforeShip: "true", lowGreenG: "3000", lowRoastedG: "500", lowFinishedPcs: "5", expiryWarnDays: "14" });
  await seedStore(db, op, { coffees, mats, roastLots: roasts.map((r) => r.lotId), pYrg: pYrg.id, pCol: pCol.id, pDrip: pDrip.id, pSet: pSet.id, pGift: pGift.id, yrg100: yrg100.id, yrg200: yrg200.id, col100: col100.id, drip1: drip1.id, set5: set5.id, gift1: gift1.id });
  console.log("示範資料建立完成：admin@ata.local ／ ata-demo-2026（僅限本機模擬器）");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
