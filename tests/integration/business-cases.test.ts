/**
 * 任務書第 10 節：核心業務驗收 Case 1～10（Firebase 版，於 Firestore 模擬器執行）。
 * 每個案例結束後驗證：每批在庫量 = 帳本加總、保留量 = 有效保留加總。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { D } from "../../src/lib/decimal";
import { C } from "../../functions/src/types";
import { baseFixture, ctx, db, docs, expectReconciled, files, lotOf, n, op, order, orderDoc, packageUnits, receiveGreen, resetDb, roast } from "../helpers";
import { runOp } from "../../functions/src/ops";

const fixture = (name: string) => readFileSync(path.join(__dirname, "..", "fixtures", name));

beforeEach(async () => {
  await resetDb();
});

describe("Case 1：烘焙與失重率", () => {
  it("投入 500g 產出 425g：生豆 −500、熟豆 +425、失重率 15%、DTR 20%", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id, 5000);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    expect(n((await lotOf(g.lotId)).onHand)).toBe(4500);
    expect(n((await lotOf(r.roastedLotId)).onHand)).toBe(425);
    expect(n(r.batch.weightLossPercent)).toBe(15);
    expect(n(r.batch.dtrPercent)).toBe(20);
    expect(D((await lotOf(r.roastedLotId)).unitCost).toFixed(4)).toBe(D(300).div(425).toFixed(4));
    await expectReconciled();
  });
  it("生豆不足時拒絕並回滾，不產生負庫存", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id, 300);
    await expect(roast(g.id, f.roaster.id, 500, 425)).rejects.toThrow(/不足/);
    expect(n((await lotOf(g.lotId)).onHand)).toBe(300);
    expect(await docs(C.roastBatches)).toHaveLength(0);
    await expectReconciled();
  });
  it("沒有事件時間時不計算 DTR（不偽計算）", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await op<{ id: string }>("roast.create", { greenLotId: g.id, roasterId: f.roaster.id, roastedAt: "2026-11-10T14:00", greenWeightG: "500", roastedWeightG: "430" });
    const b = (await db.collection(C.roastBatches).doc(r.id).get()).data()!;
    expect(b.dtrPercent).toBeNull();
    expect(b.totalTimeSec).toBeNull();
  });
});

describe("Case 2：熟豆分裝", () => {
  it("425g 分裝 4 包 ×100g + 損耗 3g → 剩 22g、成品 +4、包材扣除、可追溯", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    const pk = await packageUnits(r.roastedLotId, f.v100.id, 4, 3);
    const roasted = await lotOf(r.roastedLotId);
    expect(n(roasted.onHand)).toBe(22);
    expect(n(roasted.reserved)).toBe(0);
    expect(n((await lotOf(pk.lotId)).onHand)).toBe(4);
    expect(n((await lotOf(f.bagLotId)).onHand)).toBe(46);
    expect(n((await lotOf(f.lblLotId)).onHand)).toBe(46);
    const expected = D(403).mul(D(300).div(425)).add(24);
    expect(D(pk.packaging.totalCost as string).toFixed(1)).toBe(expected.toFixed(1));
    expect(pk.packaging.roastBatchId).toBe(r.batch.id);
    await expectReconciled();
  });
  it("包材不足時整個分裝交易回滾", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id, 10000);
    const r = await roast(g.id, f.roaster.id, 1000, 850);
    await packageUnits(r.roastedLotId, f.v100.id, 8);
    await expect(packageUnits(r.roastedLotId, f.v100.id, 60)).rejects.toThrow();
    const roasted = await lotOf(r.roastedLotId);
    expect(n(roasted.onHand)).toBe(50);
    expect(n(roasted.reserved)).toBe(0);
    expect(await docs(C.packagingBatches)).toHaveLength(1);
    await expectReconciled();
  });
  it("濾掛可自訂填充重量", async () => {
    const f = await baseFixture();
    const drip = await op<{ id: string }>("product.save", { code: "P-DRIP", name: "濾掛", category: "DRIP_BAG", coffeeId: f.coffee.id, status: "ACTIVE" });
    const vd = await op<{ id: string }>("variant.save", { productId: drip.id, sku: "DRIP-1", name: "單包", listPrice: "40", salePrice: "40", stockPolicy: "STOCK_ONLY", status: "ACTIVE" });
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    await packageUnits(r.roastedLotId, vd.id, 10, 0, "11.5");
    expect(n((await lotOf(r.roastedLotId)).onHand)).toBe(310);
  });
});

describe("Case 3：訂單保留與並行", () => {
  it("4 包庫存，兩筆並行各訂 3 包：只能成功一筆，不超賣", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    const pk = await packageUnits(r.roastedLotId, f.v100.id, 4);
    const results = await Promise.allSettled([order(f.v100.id, 3), order(f.v100.id, 3)]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const fail = results.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(String(fail.reason.message)).toMatch(/不可超賣|不足/);
    const lot = await lotOf(pk.lotId);
    expect(n(lot.onHand)).toBe(4);
    expect(n(lot.reserved)).toBe(3);
    expect(await docs(C.orders)).toHaveLength(1);
    await expectReconciled();
  });
  it("多筆並行小訂單總保留量不超過庫存", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 1000, 850);
    const pk = await packageUnits(r.roastedLotId, f.v100.id, 5);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => order(f.v100.id, 1)));
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(5);
    expect(n((await lotOf(pk.lotId)).reserved)).toBe(5);
    await expectReconciled();
  });
  it("相同 idempotencyKey 重送不會重複建立訂單", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    await packageUnits(r.roastedLotId, f.v100.id, 4);
    const a = await order(f.v100.id, 1, "web-123");
    const b = await order(f.v100.id, 1, "web-123");
    expect(b.duplicate).toBe(true);
    expect(b.id).toBe(a.id);
    expect(await docs(C.orders)).toHaveLength(1);
  });
});

describe("Case 4：重複確認付款", () => {
  it("重複確認只記錄一次，不扣庫存、不產生出貨", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    const pk = await packageUnits(r.roastedLotId, f.v100.id, 4);
    const o = await order(f.v100.id, 2);
    const results = await Promise.all([1, 2, 3].map(() => op<{ alreadyPaid: boolean }>("order.confirmPayment", { orderId: o.id, reference: "末五碼 12345" })));
    expect(results.filter((x) => !x.alreadyPaid)).toHaveLength(1);
    expect(await docs(C.payments, "orderId", o.id)).toHaveLength(1);
    const lot = await lotOf(pk.lotId);
    expect(n(lot.onHand)).toBe(4);
    expect(n(lot.reserved)).toBe(2);
    expect((await orderDoc(o.id)).paymentStatus).toBe("PAID");
    expect((await orderDoc(o.id)).shipment).toBeNull();
    await expectReconciled();
  });
  it("重複出貨被拒絕，不重複扣帳", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    const pk = await packageUnits(r.roastedLotId, f.v100.id, 4);
    const o = await order(f.v100.id, 2);
    await op("order.confirmPayment", { orderId: o.id });
    const results = await Promise.allSettled([op("order.ship", { orderId: o.id, trackingNo: "A1" }), op("order.ship", { orderId: o.id, trackingNo: "A1" })]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const lot = await lotOf(pk.lotId);
    expect(n(lot.onHand)).toBe(2);
    expect(n(lot.reserved)).toBe(0);
    expect((await docs(C.txs)).filter((t) => t.type === "SHIPMENT_ISSUE")).toHaveLength(1);
    await expectReconciled();
  });
});

describe("Case 5：取消訂單", () => {
  it("取消未出貨訂單：釋放保留、恢復可售、保留歷史", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    const pk = await packageUnits(r.roastedLotId, f.v100.id, 4);
    const o = await order(f.v100.id, 3);
    expect(n((await lotOf(pk.lotId)).reserved)).toBe(3);
    await op("order.cancel", { orderId: o.id, reason: "顧客取消" });
    const lot = await lotOf(pk.lotId);
    expect(n(lot.reserved)).toBe(0);
    expect(n(lot.onHand)).toBe(4);
    const resv = await docs(C.reservations, "lotId", pk.lotId);
    expect(resv).toHaveLength(1);
    expect(resv[0].status).toBe("RELEASED");
    expect((await docs(C.allocations, "orderId", o.id))[0].status).toBe("RELEASED");
    await expect(order(f.v100.id, 4)).resolves.toBeTruthy();
    await expectReconciled();
  });
  it("已出貨訂單不可取消", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    await packageUnits(r.roastedLotId, f.v100.id, 4);
    const o = await order(f.v100.id, 1);
    await op("order.confirmPayment", { orderId: o.id });
    await op("order.ship", { orderId: o.id });
    await expect(op("order.cancel", { orderId: o.id })).rejects.toThrow(/退貨/);
  });
});

describe("Case 6：接單後分裝", () => {
  it("無 200g 現貨 → 待分裝、預留熟豆、完成後分配、熟豆不重複使用", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    const o = await order(f.v200.id, 2);
    expect((await orderDoc(o.id)).fulfillmentStatus).toBe("AWAITING_PACKAGING");
    const po = (await docs(C.productionOrders, "orderId", o.id))[0];
    expect(po.mode).toBe("MADE_TO_ORDER");
    expect(n((await lotOf(r.roastedLotId)).reserved)).toBe(400);
    await expect(packageUnits(r.roastedLotId, f.v100.id, 1)).rejects.toThrow(/不足/);
    await expect(order(f.v200.id, 1)).rejects.toThrow(/無法接單後分裝|不足/);
    await op("production.complete", { id: po.id, actualQty: "2", lossG: "2" });
    expect((await orderDoc(o.id)).fulfillmentStatus).toBe("READY_TO_SHIP");
    const allocs = await docs(C.allocations, "orderId", o.id);
    expect(allocs).toHaveLength(1);
    expect(n(allocs[0].quantity)).toBe(2);
    expect((await docs(C.orderItems, "orderId", o.id))[0].costSnapshot).not.toBeNull();
    const roasted = await lotOf(r.roastedLotId);
    expect(n(roasted.onHand)).toBe(23);
    expect(n(roasted.reserved)).toBe(0);
    const fg = await lotOf(allocs[0].lotId as string);
    expect(n(fg.onHand)).toBe(2);
    expect(n(fg.reserved)).toBe(2);
    await expectReconciled();
  });
  it("取消接單後分裝訂單：取消生產單並釋放熟豆預留", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    const o = await order(f.v200.id, 1);
    await op("order.cancel", { orderId: o.id });
    expect(n((await lotOf(r.roastedLotId)).reserved)).toBe(0);
    expect((await docs(C.productionOrders))[0].status).toBe("CANCELLED");
    await expectReconciled();
  });
});

describe("Case 7：歷史成本快照", () => {
  it("出貨後調整生豆成本與售價：舊訂單快照不變，新交易使用新值", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id, 5000, 600);
    const r1 = await roast(g.id, f.roaster.id, 500, 425);
    await packageUnits(r1.roastedLotId, f.v100.id, 4);
    const o = await order(f.v100.id, 2);
    await op("order.confirmPayment", { orderId: o.id });
    await op("order.ship", { orderId: o.id });
    const before = await orderDoc(o.id);
    const itemBefore = (await docs(C.orderItems, "orderId", o.id))[0];
    await op("green.correctCost", { greenLotId: g.id, unitPricePerKg: "1200", reason: "供應商補開發票" });
    await op("variant.save", { id: f.v100.id, productId: f.product.id, sku: "YRG-100", name: "100g", listPrice: "550", salePrice: "520", fillWeightG: "100", stockPolicy: "STOCK_ONLY", status: "ACTIVE", materials: [] });
    const after = await orderDoc(o.id);
    const itemAfter = (await docs(C.orderItems, "orderId", o.id))[0];
    expect(after.total).toBe(before.total);
    expect(itemAfter.unitPriceSnapshot).toBe("420.00");
    expect(itemAfter.costSnapshot).toBe(itemBefore.costSnapshot);
    const r2 = await roast(g.id, f.roaster.id, 500, 425);
    expect(n(r2.batch.greenCostTotal)).toBe(600);
    const o2 = await order(f.v100.id, 1);
    expect((await docs(C.orderItems, "orderId", o2.id))[0].unitPriceSnapshot).toBe("520.00");
  });
});

describe("Case 8：退貨", () => {
  it("出貨後退貨進入待檢，不增加可售；檢查後才重新入庫", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    const pk = await packageUnits(r.roastedLotId, f.v100.id, 4);
    const o = await order(f.v100.id, 2);
    await op("order.confirmPayment", { orderId: o.id });
    await op("order.ship", { orderId: o.id });
    expect(n((await lotOf(pk.lotId)).onHand)).toBe(2);
    const alloc = (await docs(C.allocations, "orderId", o.id))[0];
    await op("order.return", { orderId: o.id, reason: "包裝破損", items: [{ allocationId: alloc.id, quantity: "2" }] });
    expect(n((await lotOf(pk.lotId)).onHand)).toBe(2);
    const rr = (await docs(C.returns, "orderId", o.id))[0];
    const item = (rr.items as Array<{ id: string; quarantineLotId: string }>)[0];
    const q = await lotOf(item.quarantineLotId);
    expect(q.status).toBe("QUARANTINE");
    expect(n(q.onHand)).toBe(2);
    expect((await orderDoc(o.id)).fulfillmentStatus).toBe("RETURN_PROCESSING");
    await expect(op("order.return", { orderId: o.id, items: [{ allocationId: alloc.id, quantity: "1" }] })).rejects.toThrow(/超過/);
    await op("order.inspectReturn", { returnId: rr.id, itemId: item.id, disposition: "RESTOCK" });
    expect(n((await lotOf(pk.lotId)).onHand)).toBe(4);
    expect(n((await lotOf(item.quarantineLotId)).onHand)).toBe(0);
    await expect(op("order.inspectReturn", { returnId: rr.id, itemId: item.id, disposition: "RESTOCK" })).rejects.toThrow(/已檢查/);
    expect((await docs(C.returns, "orderId", o.id))[0].status).toBe("COMPLETED");
    await expectReconciled();
  });
});

describe("Case 9：曲線匯入", () => {
  it("合法 CSV：預覽、匯入、保存雜湊、計算 RoR；重複匯入拒絕", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    files.set("uploads/u/a.csv", fixture("curve-valid.csv"));
    const preview = await op<{ pointCount: number; mapping: Record<string, string>; rorComputed: boolean }>("curve.preview", { storagePath: "uploads/u/a.csv", fileName: "curve-valid.csv", roastBatchId: r.batch.id });
    expect(preview.pointCount).toBe(21);
    expect(preview.mapping).toMatchObject({ time: "time", bt: "BT", et: "ET" });
    expect(preview.rorComputed).toBe(true);
    await op("curve.import", { storagePath: "uploads/u/a.csv", fileName: "curve-valid.csv", roastBatchId: r.batch.id });
    const curves = await docs(C.roastCurves, "roastBatchId", r.batch.id);
    expect(curves).toHaveLength(1);
    expect(curves[0].pointCount).toBe(21);
    expect(curves[0].fileSha256).toMatch(/^[0-9a-f]{64}$/);
    const chunk = (await db.collection(`${C.roastCurves}/${curves[0].id}/chunks`).doc("0").get()).data()!;
    expect(chunk.points).toHaveLength(21);
    expect(chunk.points[20].ror).not.toBeNull();
    await expect(op("curve.import", { storagePath: "uploads/u/a.csv", fileName: "again.csv", roastBatchId: r.batch.id })).rejects.toThrow(/重複匯入/);
  });
  it("錯誤格式給出具體行號", async () => {
    files.set("uploads/u/b.csv", fixture("curve-invalid.csv"));
    try {
      await runOp("curve.preview", { storagePath: "uploads/u/b.csv", fileName: "b.csv", mapping: { time: "time", bt: "BT", et: "ET" } }, ctx);
      expect.unreachable();
    } catch (e) {
      const msg = (e as { errors?: string[] }).errors?.join("\n") ?? String(e);
      expect(msg).toMatch(/第 4 行：時間 .* 未遞增/);
      expect(msg).toMatch(/第 5 行：豆溫 BT「abc」不是數字/);
      expect(msg).toMatch(/第 6 行：BT 520°C 超出合理範圍/);
    }
  });
  it("Artisan .alog 匯入事件", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    files.set("uploads/u/c.alog", fixture("sample.alog"));
    await op("curve.import", { storagePath: "uploads/u/c.alog", fileName: "sample.alog", roastBatchId: r.batch.id, importEvents: true });
    const b = (await db.collection(C.roastBatches).doc(r.batch.id).get()).data()!;
    expect((b.events as Array<{ type: string }>).map((e) => e.type)).toEqual(["CHARGE", "DRY_END", "FC_START", "DROP"]);
  });
});

describe("Case 10：全流程追溯", () => {
  it("已出貨訂單 → 品項 → 包裝批次 → 烘焙批次 → 生豆批次，數量一致、無個資", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    const pk = await packageUnits(r.roastedLotId, f.v100.id, 4, 3);
    const o = await op<{ id: string }>("order.create", { customerName: "王小明", customerPhone: "0912345678", shippingAddress: "臺北市", items: [{ variantId: f.v100.id, quantity: "2" }] });
    await op("order.confirmPayment", { orderId: o.id });
    await op("order.ship", { orderId: o.id });
    const t = await op<{ chains: Array<Record<string, any>>; checks: Array<Record<string, unknown>> }>("order.trace", { orderId: o.id }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const c = t.chains[0];
    expect(c.sku).toBe("YRG-100");
    expect(c.packaging.batchNo).toBe(pk.packaging.batchNo);
    expect(c.roast.batchNo).toBe(r.batch.batchNo);
    expect(c.green.lotCode).toBe((await db.collection(C.greenLots).doc(g.id).get()).data()!.lotCode);
    expect(t.checks[0]).toMatchObject({ sku: "YRG-100", ordered: 2, allocated: "2" });
    expect(D(c.unitCost).toFixed(4)).toBe(D(pk.packaging.unitCost as string).toFixed(4));
    expect(JSON.stringify(t)).not.toMatch(/王小明|0912345678|臺北市/);
  });
});

describe("帳本完整性", () => {
  it("手動異動與沖銷：杯測耗用 −20g 後沖銷，餘額回復且原交易保留；不可重複沖銷", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.id, f.roaster.id, 500, 425);
    await op("inventory.adjust", { lotId: r.roastedLotId, type: "CUPPING_USE", quantity: "20" });
    expect(n((await lotOf(r.roastedLotId)).onHand)).toBe(405);
    const t = (await docs(C.txs, "lotId", r.roastedLotId)).find((x) => x.type === "CUPPING_USE")!;
    await op("inventory.reverse", { txId: t.id, note: "誤記" });
    expect(n((await lotOf(r.roastedLotId)).onHand)).toBe(425);
    await expect(op("inventory.reverse", { txId: t.id, note: "再次" })).rejects.toThrow(/已被沖銷/);
    expect(await docs(C.txs, "lotId", r.roastedLotId)).toHaveLength(3);
    await expectReconciled();
  });
  it("輸入驗證：非法數量被拒絕並回傳欄位錯誤", async () => {
    const f = await baseFixture();
    await expect(op("green.receive", { coffeeId: f.coffee.id, purchaseDate: "2026-11-01", receivedAt: "2026-11-02T10:00", purchasedWeightG: "-5", receivedWeightG: "abc", unitPricePerKg: "1" })).rejects.toMatchObject({ fieldErrors: expect.objectContaining({ purchasedWeightG: expect.any(String) }) });
  });
});
