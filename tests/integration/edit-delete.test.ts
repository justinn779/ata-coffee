/**
 * 第一級新增功能：出貨前修改訂單、杯測／手沖／研究紀錄的修改與刪除（於 Firestore 模擬器執行）。
 * 每個案例結束後驗證帳本一致（在庫量 = 帳本加總、保留量 = 有效保留加總）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { C } from "../../functions/src/types";
import { baseFixture, docs, expectReconciled, lotOf, n, op, order, orderDoc, packageUnits, receiveGreen, resetDb, roast } from "../helpers";

beforeEach(async () => {
  await resetDb();
});

async function stock(qty100: number) {
  const f = await baseFixture();
  const g = await receiveGreen(f.coffee.id);
  const r = await roast(g.id, f.roaster.id, 500, 425);
  const pk = await packageUnits(r.roastedLotId, f.v100.id, qty100);
  return { f, r, pk };
}

const items = (...xs: Array<[string, number, string?]>) => xs.map(([variantId, q, discount]) => ({ variantId, quantity: String(q), discount }));

describe("出貨前修改訂單", () => {
  it("改數量：釋放舊保留、重新保留，金額重算，帳本一致", async () => {
    const { f, pk } = await stock(4);
    const o = await order(f.v100.id, 1);
    expect(n((await lotOf(pk.lotId)).reserved)).toBe(1);
    await op("order.update", { orderId: o.id, customerName: "測試顧客", items: items([f.v100.id, 3, "20"]), shippingFee: "100" });
    const after = await orderDoc(o.id);
    expect(n(after.subtotal)).toBe(420 * 3 - 20);
    expect(n(after.total)).toBe(420 * 3 - 20 + 100);
    expect(after.fulfillmentStatus).toBe("READY_TO_SHIP");
    expect(n((await lotOf(pk.lotId)).reserved)).toBe(3);
    const its = await docs(C.orderItems, "orderId", o.id);
    expect(its).toHaveLength(1);
    expect(its[0].quantity).toBe(3);
    const allocs = await docs(C.allocations, "orderId", o.id);
    expect(allocs.every((a) => a.status === "RESERVED")).toBe(true);
    expect(allocs.reduce((s, a) => s + n(a.quantity), 0)).toBe(3);
    expect((await docs(C.audit, "action", "order.update"))).toHaveLength(1);
    await expectReconciled();
  });

  it("超過庫存時修改失敗，原訂單與保留完全不變（不超賣）", async () => {
    const { f, pk } = await stock(4);
    const o = await order(f.v100.id, 2);
    const other = await order(f.v100.id, 1);
    await expect(op("order.update", { orderId: o.id, customerName: "測試顧客", items: items([f.v100.id, 4]) })).rejects.toThrow(/不足|超賣/);
    expect(n((await lotOf(pk.lotId)).reserved)).toBe(3);
    expect((await docs(C.orderItems, "orderId", o.id))[0].quantity).toBe(2);
    expect(n((await orderDoc(o.id)).total)).toBe(840);
    expect(other).toBeTruthy();
    await expectReconciled();
  });

  it("沿用原單價：調整售價後修改數量，原品項仍用下單時價格", async () => {
    const { f } = await stock(4);
    const o = await order(f.v100.id, 1);
    const v = (await docs(C.variants)).find((x) => x.id === f.v100.id)!;
    await op("variant.save", { id: f.v100.id, productId: v.productId, sku: "YRG-100", name: "100g", listPrice: "500", salePrice: "480", fillWeightG: "100", stockPolicy: "STOCK_ONLY", status: "ACTIVE", materials: v.materials });
    await op("order.update", { orderId: o.id, customerName: "測試顧客", items: items([f.v100.id, 2]) });
    expect(n((await docs(C.orderItems, "orderId", o.id))[0].unitPriceSnapshot)).toBe(420);
    expect(n((await orderDoc(o.id)).total)).toBe(840);
  });

  it("改成接單後分裝品項：取消原分裝單、建立新分裝單並預留熟豆", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    const o = await order(f.v200.id, 1);
    expect(n((await lotOf(r.roastedLotId)).reserved)).toBe(200);
    await op("order.update", { orderId: o.id, customerName: "測試顧客", items: items([f.v200.id, 2]) });
    const pos = await docs(C.productionOrders, "orderId", o.id);
    expect(pos.filter((p) => p.status === "CANCELLED")).toHaveLength(1);
    expect(pos.filter((p) => p.status === "PLANNED")).toHaveLength(1);
    expect(n((await lotOf(r.roastedLotId)).reserved)).toBe(400);
    expect((await orderDoc(o.id)).fulfillmentStatus).toBe("AWAITING_PACKAGING");
    await expectReconciled();
  });

  it("已確認付款或已出貨的訂單：修改前先提醒", async () => {
    const { f } = await stock(4);
    const o = await order(f.v100.id, 1);
    await op("order.confirmPayment", { orderId: o.id });
    await expect(op("order.update", { orderId: o.id, customerName: "測試顧客", items: items([f.v100.id, 2]) })).rejects.toThrow(/已確認付款/);
    await op("order.ship", { orderId: o.id });
    await expect(op("order.update", { orderId: o.id, customerName: "測試顧客", items: items([f.v100.id, 2]) })).rejects.toThrow(/已出貨/);
    await expectReconciled();
  });
});

describe("杯測／手沖／研究紀錄修改與刪除", () => {
  async function setup() {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    const tpl = await op<{ id: string }>("template.create", { name: "測試模板", scaleMin: "0", scaleMax: "10", step: "0.25", isDefault: "true", attributes: "aroma:香氣\nacidity:酸質" });
    return { f, r, tpl };
  }

  it("杯測：修改耗用量自動沖銷重扣；刪除後庫存回復", async () => {
    const { r, tpl } = await setup();
    const c = await op<{ id: string }>("cupping.create", { roastBatchId: r.batch.id, templateId: tpl.id, cuppedAt: "2026-11-12T10:00", scores: { aroma: "8", acidity: "7" }, consumedG: "20", deductStock: true });
    expect(n((await lotOf(r.roastedLotId)).onHand)).toBe(405);
    await op("cupping.update", { id: c.id, templateId: tpl.id, cuppedAt: "2026-11-13T10:00", scores: { aroma: "9", acidity: "8" }, consumedG: "15", deductStock: true });
    expect(n((await lotOf(r.roastedLotId)).onHand)).toBe(410);
    const s = (await docs(C.cuppings)).find((x) => x.id === c.id)!;
    expect(n(s.totalScore)).toBe(8.5);
    expect(s.restDays).toBe(3);
    // 只改文字不改數量：不產生新交易
    const before = (await docs(C.txs, "lotId", r.roastedLotId)).length;
    await op("cupping.update", { id: c.id, templateId: tpl.id, cuppedAt: "2026-11-13T10:00", scores: { aroma: "9", acidity: "8" }, consumedG: "15", deductStock: true, description: "補充描述" });
    expect(await docs(C.txs, "lotId", r.roastedLotId)).toHaveLength(before);
    await op("cupping.delete", { id: c.id });
    expect(n((await lotOf(r.roastedLotId)).onHand)).toBe(425);
    expect(await docs(C.cuppings)).toHaveLength(0);
    await expectReconciled();
  });

  it("手沖：取消扣庫存時沖銷；刪除未扣庫存的紀錄不動庫存", async () => {
    const { r } = await setup();
    const b = await op<{ id: string }>("brew.create", { roastBatchId: r.batch.id, brewedAt: "2026-11-12T10:00", doseG: "15", waterG: "240", deductStock: true });
    expect(n((await lotOf(r.roastedLotId)).onHand)).toBe(410);
    await op("brew.update", { id: b.id, brewedAt: "2026-11-12T10:00", doseG: "18", waterG: "270", deductStock: true, rating: "8" });
    expect(n((await lotOf(r.roastedLotId)).onHand)).toBe(407);
    expect((await docs(C.brews))[0].ratio).toBe("15.00");
    await op("brew.update", { id: b.id, brewedAt: "2026-11-12T10:00", doseG: "18", waterG: "270", deductStock: false });
    expect(n((await lotOf(r.roastedLotId)).onHand)).toBe(425);
    await op("brew.delete", { id: b.id });
    expect(n((await lotOf(r.roastedLotId)).onHand)).toBe(425);
    expect(await docs(C.brews)).toHaveLength(0);
    await expectReconciled();
  });

  it("研究：修改與刪除實驗版本、刪除專案", async () => {
    const { r } = await setup();
    const p = await op<{ id: string }>("research.save", { name: "DTR 測試", status: "RUNNING" });
    await op("research.addExperiment", { projectId: p.id, label: "A", experimentDate: "2026-11-12", isBaseline: "true" });
    await op("research.addExperiment", { projectId: p.id, label: "B", experimentDate: "2026-11-13", isBaseline: "false" });
    let proj = (await docs(C.research))[0];
    const [a, b] = proj.experiments as Array<{ id: string }>;
    await op("research.updateExperiment", { projectId: p.id, expId: b.id, label: "B2", experimentDate: "2026-11-14", isBaseline: "true", variableValues: "DTR:20%", roastBatchId: r.batch.id });
    proj = (await docs(C.research))[0];
    const exps = proj.experiments as Array<Record<string, unknown>>;
    expect(exps.find((e) => e.id === b.id)).toMatchObject({ label: "B2", isBaseline: true, variableValues: { DTR: "20%" }, batchNo: r.batch.batchNo, version: 2 });
    expect(exps.find((e) => e.id === a.id)!.isBaseline).toBe(false);
    await op("research.deleteExperiment", { projectId: p.id, expId: a.id });
    expect((await docs(C.research))[0].experiments).toHaveLength(1);
    await op("research.delete", { id: p.id });
    expect(await docs(C.research)).toHaveLength(0);
  });
});
