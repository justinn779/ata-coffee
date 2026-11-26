/**
 * 關聯不再擋住：第一次送出先回傳提醒（CONFIRM），使用者確認後帶 force 照樣執行，並回傳提醒文字。
 * 其他紀錄保留原本的名稱、批號，標示來源已刪除；帳本仍一致。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { C } from "../../functions/src/types";
import { baseFixture, docs, expectReconciled, lotOf, n, op, order, orderDoc, packageUnits, receiveGreen, resetDb, roast } from "../helpers";

beforeEach(async () => {
  await resetDb();
});

type W = { id?: string; warnings?: string[] };
const tplOf = () => op<{ id: string }>("template.create", { name: "模板", scaleMin: "0", scaleMax: "10", step: "0.25", isDefault: "true", attributes: "aroma:香氣" });

describe("先提醒、確認後照樣執行", () => {
  it("刪除已烘焙的生豆採購：先提醒，確認後烘焙紀錄保留並標示生豆採購已刪除", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    await expect(op("green.delete", { id: g.id })).rejects.toMatchObject({ code: "CONFIRM" });
    const res = await op<W>("green.delete", { id: g.id, force: true });
    expect(res.warnings?.join()).toMatch(/烘焙紀錄/);
    const rb = (await docs(C.roastBatches)).find((x) => x.id === r.batch.id)!;
    expect(rb.greenLotId).toBeNull();
    expect(rb.greenLotDeleted).toBe(true);
    expect(rb.greenLotCode).toBeTruthy();
    // 之後還能修改這批烘焙（沒有生豆採購）
    const upd = await op<W>("roast.update", { id: r.batch.id, roasterId: f.roaster.id, roastedAt: "2026-11-01T10:00", greenWeightG: "500", roastedWeightG: "420" });
    expect(n((await lotOf(r.roastedLotId)).onHand)).toBe(420);
    expect(upd.warnings ?? []).toEqual([]);
    await expectReconciled();
  });

  it("烘豆可以不選生豆，直接選咖啡豆；生豆成本為 0，不扣生豆庫存", async () => {
    const f = await baseFixture();
    const res = await op<W>("roast.create", { coffeeId: f.coffee.id, roasterId: f.roaster.id, roastedAt: "2026-11-01T10:00", greenWeightG: "500", roastedWeightG: "425" });
    expect(res.warnings?.join()).toMatch(/沒有對應的生豆採購/);
    const rb = (await docs(C.roastBatches)).find((x) => x.id === res.id)!;
    expect(rb.greenLotId).toBeNull();
    expect(rb.coffeeId).toBe(f.coffee.id);
    expect(n(rb.greenCostTotal)).toBe(0);
    expect(n((await lotOf(rb.invLotId as string)).onHand)).toBe(425);
    // 之後補選生豆批次：扣生豆、重算成本
    const g = await receiveGreen(f.coffee.id, 5000, 600);
    await op("roast.update", { id: res.id, greenLotId: g.id, roasterId: f.roaster.id, roastedAt: "2026-11-01T10:00", greenWeightG: "500", roastedWeightG: "425" });
    const gl = (await docs(C.greenLots)).find((x) => x.id === g.id)!;
    expect(n((await lotOf(gl.invLotId as string)).onHand)).toBe(4500);
    expect(n((await docs(C.roastBatches)).find((x) => x.id === res.id)!.greenCostTotal)).toBe(300);
    await expectReconciled();
  });

  it("生豆不夠也能烘：先提醒，確認後生豆庫存變負數", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id, 300);
    const input = { greenLotId: g.id, roasterId: f.roaster.id, roastedAt: "2026-11-01T10:00", greenWeightG: "500", roastedWeightG: "425" };
    await expect(op("roast.create", input)).rejects.toMatchObject({ code: "CONFIRM" });
    const res = await op<W>("roast.create", { ...input, force: true });
    expect(res.warnings?.join()).toMatch(/庫存不足/);
    const gl = (await docs(C.greenLots)).find((x) => x.id === g.id)!;
    expect(n((await lotOf(gl.invLotId as string)).onHand)).toBe(-200);
    await expectReconciled();
  });

  it("刪除有杯測的烘焙：杯測保留批號與烘焙日期，可以再改選來源", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    const tpl = await tplOf();
    const c = await op<{ id: string }>("cupping.create", { roastBatchId: r.batch.id, templateId: tpl.id, cuppedAt: "2026-11-15T10:00", scores: { aroma: "8" }, consumedG: "10", deductStock: true });
    await expect(op("roast.delete", { id: r.batch.id })).rejects.toMatchObject({ code: "CONFIRM" });
    await op("roast.delete", { id: r.batch.id, force: true });
    let s = (await docs(C.cuppings)).find((x) => x.id === c.id)!;
    expect(s.roastBatchId).toBeNull();
    expect(s.roastDeleted).toBe(true);
    expect(String(s.batchNo)).toMatch(/^RB-/);
    expect(s.sampleRoastedDate).toBeTruthy();
    // 修改時保留原批號；改選另一批烘焙後就連到新批次
    await op("cupping.update", { id: c.id, templateId: tpl.id, roastedDate: s.sampleRoastedDate, cuppedAt: "2026-11-15T10:00", scores: { aroma: "9" } });
    s = (await docs(C.cuppings)).find((x) => x.id === c.id)!;
    expect(String(s.batchNo)).toMatch(/^RB-/);
    const r2 = await roast(g.id, f.roaster.id, 500, 420);
    await op("cupping.update", { id: c.id, roastBatchId: r2.batch.id, templateId: tpl.id, cuppedAt: "2026-11-15T10:00", scores: { aroma: "9" }, consumedG: "10", deductStock: true });
    s = (await docs(C.cuppings)).find((x) => x.id === c.id)!;
    expect(s.roastBatchId).toBe(r2.batch.id);
    expect(s.roastDeleted).toBe(false);
    expect(n((await lotOf(r2.roastedLotId)).onHand)).toBe(410);
    await expectReconciled();
  });

  it("杯測時間早於烘焙時間只提醒，照樣存檔", async () => {
    const f = await baseFixture();
    const tpl = await tplOf();
    const res = await op<W>("cupping.create", { coffeeId: f.coffee.id, roastedDate: "2026-11-20", templateId: tpl.id, cuppedAt: "2026-11-15T10:00", scores: { aroma: "8" } });
    expect(res.warnings?.join()).toMatch(/早於烘焙時間/);
    expect((await docs(C.cuppings))[0].restDays).toBe(-5);
  });

  it("刪除有紀錄的咖啡豆：先提醒，確認後紀錄保留原名稱", async () => {
    const f = await baseFixture();
    await op("brew.create", { coffeeId: f.coffee.id, brewedAt: "2026-11-11T09:00", doseG: "15", waterG: "240" });
    await expect(op("master.delete", { col: C.coffees, id: f.coffee.id })).rejects.toMatchObject({ code: "CONFIRM" });
    await op("master.delete", { col: C.coffees, id: f.coffee.id, force: true });
    const b = (await docs(C.brews))[0];
    expect(b.coffeeName).toBe("耶加雪菲 水洗");
  });

  it("超賣：先提醒，確認後訂單成立但待備貨；之後修改訂單可重新保留", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    const pk = await packageUnits(r.roastedLotId, f.v100.id, 1);
    const input = { customerName: "測試顧客", items: [{ variantId: f.v100.id, quantity: "3" }] };
    await expect(op("order.create", input)).rejects.toMatchObject({ code: "CONFIRM" });
    const o = await op<{ id: string; warnings?: string[] }>("order.create", { ...input, force: true });
    expect(o.warnings?.join()).toMatch(/不足訂購/);
    const od = await orderDoc(o.id);
    expect(od.fulfillmentStatus).toBe("AWAITING_PACKAGING");
    expect(n((await lotOf(pk.lotId)).reserved)).toBe(1);
    // 沒備妥也能出貨（確認後只扣已保留的部分）
    await op("order.confirmPayment", { orderId: o.id });
    await expect(op("order.ship", { orderId: o.id })).rejects.toMatchObject({ code: "CONFIRM" });
    await op("order.ship", { orderId: o.id, force: true });
    expect((await orderDoc(o.id)).fulfillmentStatus).toBe("SHIPPED");
    expect(n((await lotOf(pk.lotId)).onHand)).toBe(0);
    await expectReconciled();
  });

  it("已收款訂單也能刪除（先提醒）", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    await packageUnits(r.roastedLotId, f.v100.id, 2);
    const o = await order(f.v100.id, 1);
    await op("order.confirmPayment", { orderId: o.id });
    await expect(op("order.delete", { id: o.id })).rejects.toMatchObject({ code: "CONFIRM" });
    await op("order.delete", { id: o.id, force: true });
    expect(await docs(C.orders)).toHaveLength(0);
    await expectReconciled();
  });
});
