/**
 * 舊資料的修改與刪除：烘焙、生豆採購、分裝、訂單、主檔。
 * 驗證庫存以差額調整、成本重算、關聯紀錄同步更新，被使用中的資料不可刪除；每案結束後帳本一致。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { C } from "../../functions/src/types";
import { baseFixture, db, docs, expectReconciled, lotOf, n, op, order, orderDoc, packageUnits, receiveGreen, resetDb, roast } from "../helpers";

beforeEach(async () => {
  await resetDb();
});

const get = async (col: string, id: string) => {
  const s = await db.collection(col).doc(id).get();
  return s.exists ? ({ ...(s.data() as object), id } as Record<string, unknown> & { id: string }) : null;
};

/** 烘焙表單欄位（修改時整份送出） */
const roastForm = (b: Record<string, unknown>, patch: Record<string, unknown> = {}) => ({
  id: b.id,
  greenLotId: b.greenLotId,
  roasterId: b.roasterId,
  roastedAt: "2026-11-10T14:00",
  greenWeightG: String(b.greenWeightG),
  roastedWeightG: String(b.roastedWeightG),
  dryEndSec: "4:00",
  firstCrackStartSec: "8:00",
  dropSec: "10:00",
  ...patch,
});

describe("修改／刪除烘焙批次", () => {
  it("改投入與出爐重量：生豆補扣、熟豆以差額調整，單位成本重算", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id, 5000, 600);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    expect(n((await lotOf(g.lotId)).onHand)).toBe(4500);
    await op("roast.update", roastForm(r.batch, { greenWeightG: "600", roastedWeightG: "500", result: "改重量" }));
    expect(n((await lotOf(g.lotId)).onHand)).toBe(4400);
    const lot = await lotOf(r.roastedLotId);
    expect(n(lot.onHand)).toBe(500);
    expect(n(lot.unitCost)).toBeCloseTo((600 * 0.6) / 500, 6);
    const b = (await get(C.roastBatches, r.batch.id))!;
    expect(n(b.weightLossPercent)).toBeCloseTo(16.667, 2);
    expect(b.result).toBe("改重量");
    expect(b.batchNo).toBe(r.batch.batchNo);
    await expectReconciled();
  });

  it("改烘焙時間：杯測的烘後天數一起更新；晚於杯測時間只提醒", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id);
    const tpl = await op<{ id: string }>("template.create", { name: "模板", scaleMin: "0", scaleMax: "10", step: "0.25", isDefault: "true", attributes: "aroma:香氣" });
    const c = await op<{ id: string }>("cupping.create", { roastBatchId: r.batch.id, templateId: tpl.id, cuppedAt: "2026-11-15T10:00", scores: { aroma: "8" } });
    expect((await get(C.cuppings, c.id))!.restDays).toBe(5);
    await op("roast.update", roastForm(r.batch, { roastedAt: "2026-11-12T09:00" }));
    expect((await get(C.cuppings, c.id))!.restDays).toBe(3);
    const w = await op<{ warnings?: string[] }>("roast.update", roastForm(r.batch, { roastedAt: "2026-11-16T09:00" }));
    expect(w.warnings?.join()).toMatch(/晚於這批已有的杯測/);
    expect((await get(C.cuppings, c.id))!.restDays).toBe(-1);
  });

  it("熟豆已分裝後：改重量、刪除前先提醒；備註等欄位直接可以改", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id);
    await packageUnits(r.roastedLotId, f.v100.id, 2);
    await expect(op("roast.update", roastForm(r.batch, { roastedWeightG: "400" }))).rejects.toThrow(/已被分裝/);
    await op("roast.update", roastForm(r.batch, { note: "補充備註" }));
    expect((await get(C.roastBatches, r.batch.id))!.note).toBe("補充備註");
    await expect(op("roast.delete", { id: r.batch.id })).rejects.toThrow(/熟豆已被分裝/);
    // 確認後照樣改：熟豆庫存依差額調整
    await op("roast.update", { ...roastForm(r.batch, { roastedWeightG: "400" }), force: true });
    expect(n((await lotOf(r.roastedLotId)).onHand)).toBe(400 - 200);
    // 確認後照樣刪除：熟豆庫存維持現狀
    await op("roast.delete", { id: r.batch.id, force: true });
    expect(await get(C.roastBatches, r.batch.id)).toBeNull();
    expect(n((await lotOf(r.roastedLotId)).onHand)).toBe(200);
    await expectReconciled();
  });

  it("刪除：生豆退回、熟豆批次作廢、曲線與成本一起刪除；有杯測時不可刪", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const created = await op<{ id: string }>("roast.create", { greenLotId: g.id, roasterId: f.roaster.id, roastedAt: "2026-11-10T14:00", greenWeightG: "500", roastedWeightG: "425", energyCost: "20", curvePoints: [{ t: 0, bt: 200 }, { t: 30, bt: 150 }] });
    const b = (await get(C.roastBatches, created.id))!;
    expect(await docs(C.roastCurves, "roastBatchId", created.id)).toHaveLength(1);
    const tpl = await op<{ id: string }>("template.create", { name: "模板", scaleMin: "0", scaleMax: "10", step: "0.25", isDefault: "true", attributes: "aroma:香氣" });
    const c = await op<{ id: string }>("cupping.create", { roastBatchId: created.id, templateId: tpl.id, cuppedAt: "2026-11-15T10:00", scores: { aroma: "8" }, consumedG: "20", deductStock: true });
    await expect(op("roast.delete", { id: created.id })).rejects.toThrow(/杯測/);
    await op("cupping.delete", { id: c.id });
    await op("roast.delete", { id: created.id });
    expect(await get(C.roastBatches, created.id)).toBeNull();
    expect(n((await lotOf(g.lotId)).onHand)).toBe(5000);
    const lot = await lotOf(b.invLotId as string);
    expect(n(lot.onHand)).toBe(0);
    expect(lot.status).toBe("SCRAPPED");
    expect(await docs(C.roastCurves, "roastBatchId", created.id)).toHaveLength(0);
    expect(await docs(C.costs, "roastBatchId", created.id)).toHaveLength(0);
    await expectReconciled();
  });
});

describe("修改／刪除生豆採購", () => {
  const greenForm = (coffeeId: string, patch: Record<string, unknown> = {}) => ({ coffeeId, purchaseDate: "2026-11-01", receivedAt: "2026-11-02T10:00", purchasedWeightG: "5000", receivedWeightG: "5000", unitPricePerKg: "600", ...patch });

  it("改入庫量與單價：庫存以差額調整，未分裝的烘焙批次重算成本，批次編號同步", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id, 5000, 600);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    await op("green.update", { id: g.id, ...greenForm(f.coffee.id, { receivedWeightG: "4800", purchasedWeightG: "4800", unitPricePerKg: "800", lotCode: "GB-NEW" }) });
    expect(n((await lotOf(g.lotId)).onHand)).toBe(4300);
    expect((await lotOf(g.lotId)).lotCode).toBe("GB-NEW");
    const rb = (await get(C.roastBatches, r.batch.id))!;
    expect(rb.greenLotCode).toBe("GB-NEW");
    expect(n(rb.greenCostTotal)).toBeCloseTo(500 * 0.8, 2);
    expect(n((await lotOf(r.roastedLotId)).unitCost)).toBeCloseTo((500 * 0.8) / 425, 6);
    await expect(op("green.update", { id: g.id, ...greenForm(f.coffee.id, { receivedWeightG: "400", purchasedWeightG: "400" }) })).rejects.toThrow(/不足/);
    await expectReconciled();
  });

  it("刪除：已烘焙時不可刪；刪除烘焙後即可刪除，庫存一併移除", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id);
    await expect(op("green.delete", { id: g.id })).rejects.toThrow(/烘焙/);
    await op("roast.delete", { id: r.batch.id });
    await op("green.delete", { id: g.id });
    expect(await get(C.greenLots, g.id)).toBeNull();
    expect(n((await lotOf(g.lotId)).onHand)).toBe(0);
    await expectReconciled();
  });
});

describe("主檔改名連動與刪除", () => {
  it("咖啡豆改名：烘焙、生豆、庫存品項與批次名稱一起更新", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id);
    await op("coffee.save", { id: f.coffee.id, code: "ETH-YRG", nameZh: "耶加雪菲 新名", country: "衣索比亞", shelfLifeDays: "180" });
    expect((await get(C.roastBatches, r.batch.id))!.coffeeName).toBe("耶加雪菲 新名");
    expect((await get(C.greenLots, g.id))!.coffeeName).toBe("耶加雪菲 新名");
    expect((await lotOf(r.roastedLotId)).itemName).toBe("熟豆｜耶加雪菲 新名");
    expect((await lotOf(g.lotId)).itemName).toBe("生豆｜耶加雪菲 新名");
  });

  it("烘豆機改名同步到烘焙紀錄；使用中不可刪除，未使用的可刪且代碼可再用", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id);
    await op("roaster.save", { id: f.roaster.id, name: "Olomo 新名", brand: "Olomo", model: "TEST" });
    expect((await get(C.roastBatches, r.batch.id))!.roasterName).toBe("Olomo 新名");
    await expect(op("master.delete", { col: "roasters", id: f.roaster.id })).rejects.toThrow(/烘焙批次 1 筆/);
    const s = await op<{ id: string }>("supplier.save", { code: "SUP-1", name: "供應商" });
    await op("master.delete", { col: "suppliers", id: s.id });
    expect(await get(C.suppliers, s.id)).toBeNull();
    await op("supplier.save", { code: "SUP-1", name: "供應商 2" });
  });

  it("顧客改名同步到訂單；有訂單時不可刪除", async () => {
    const f = await baseFixture();
    await roast((await receiveGreen(f.coffee.id)).id, f.roaster.id);
    const c = await op<{ id: string }>("customer.save", { name: "王小明" });
    const o = await op<{ id: string }>("order.create", { customerId: c.id, customerName: "王小明", items: [{ variantId: f.v200.id, quantity: "1" }] });
    await op("customer.save", { id: c.id, name: "王大明", phone: "0912" });
    const od = await orderDoc(o.id);
    expect(od.customerName).toBe("王大明");
    expect(od.customerPhone).toBe("0912");
    await expect(op("master.delete", { col: "customers", id: c.id })).rejects.toThrow(/訂單/);
  });
});

describe("分裝與訂單", () => {
  it("撤銷完成：熟豆與包材退回、成品作廢、重新預留；之後可刪除", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    const pk = await packageUnits(r.roastedLotId, f.v100.id, 3, 5);
    expect(n((await lotOf(r.roastedLotId)).onHand)).toBe(425 - 305);
    await op("production.reopen", { id: pk.poId });
    const src = await lotOf(r.roastedLotId);
    expect(n(src.onHand)).toBe(425);
    expect(n(src.reserved)).toBe(300);
    expect(n((await lotOf(f.bagLotId)).onHand)).toBe(50);
    expect((await lotOf(pk.lotId)).status).toBe("SCRAPPED");
    expect(await get(C.packagingBatches, pk.packaging.id)).toBeNull();
    expect((await get(C.productionOrders, pk.poId))!.status).toBe("PLANNED");
    await op("production.update", { id: pk.poId, plannedQty: "2", plannedDate: "2026-11-22" });
    expect(n((await lotOf(r.roastedLotId)).reserved)).toBe(200);
    await op("production.delete", { id: pk.poId });
    expect(n((await lotOf(r.roastedLotId)).reserved)).toBe(0);
    // 分裝撤銷、刪除後，烘焙批次又可以修改重量
    await op("roast.update", roastForm(r.batch, { roastedWeightG: "420" }));
    await expectReconciled();
  });

  it("刪除未出貨訂單：釋放保留並刪除明細；已出貨的不能刪", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id);
    const pk = await packageUnits(r.roastedLotId, f.v100.id, 3);
    const o = await order(f.v100.id, 2);
    expect(n((await lotOf(pk.lotId)).reserved)).toBe(2);
    await op("order.delete", { id: o.id });
    expect(await get(C.orders, o.id)).toBeNull();
    expect(await docs(C.orderItems, "orderId", o.id)).toHaveLength(0);
    expect(n((await lotOf(pk.lotId)).reserved)).toBe(0);
    const o2 = await order(f.v100.id, 1);
    await op("order.confirmPayment", { orderId: o2.id });
    await op("order.ship", { orderId: o2.id });
    await expect(op("order.delete", { id: o2.id })).rejects.toThrow(/出貨|收款/);
    await op("order.updateInfo", { orderId: o2.id, customerName: "改名顧客", trackingNo: "T123" });
    const od = await orderDoc(o2.id);
    expect(od.customerName).toBe("改名顧客");
    expect((od.shipment as { trackingNo: string }).trackingNo).toBe("T123");
    await expectReconciled();
  });
});
