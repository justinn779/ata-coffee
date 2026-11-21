/**
 * 任務書第 10 節：核心業務驗收測試（Case 1～10），使用真實 PostgreSQL（ata_test）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, withTx } from "@/lib/db";
import { D } from "@/lib/decimal";
import { reconcile, manualAdjust, reverseTransaction } from "@/server/domain/inventory";
import { correctGreenCost } from "@/server/domain/green";
import {
  cancelOrder,
  confirmPayment,
  createOrder,
  createReturn,
  inspectReturnItem,
  shipOrder,
} from "@/server/domain/orders";
import { completeProductionOrder } from "@/server/domain/production";
import { traceOrder } from "@/server/domain/traceability";
import { parseArtisanAlog, parseCsvCurve, detectMapping, preprocessCsv, CurveParseError } from "@/server/curves/parse";
import { saveCurve, sha256 } from "@/server/curves/import";
import { actor, baseFixture, lotOf, n, packageUnits, receiveGreen, resetDb, roast } from "../helpers";

const fixture = (name: string) => readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8");

async function expectReconciled() {
  const diff = await reconcile(prisma);
  expect(diff).toEqual([]);
}

const order = (variantId: string, quantity: number, key?: string) =>
  withTx((tx) => createOrder(tx, { customerName: "測試顧客", items: [{ variantId, quantity }], idempotencyKey: key }, actor));

beforeEach(async () => {
  await resetDb();
});

describe("Case 1：烘焙與失重率", () => {
  it("投入 500g 產出 425g：生豆 −500、熟豆 +425、失重率 15%", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id, 5000);
    const r = await roast(g.greenLot.id, f.roaster.id, 500, 425);

    expect(n((await lotOf(g.lot.id)).onHand)).toBe(4500);
    expect(n((await lotOf(r.roastedLot.id)).onHand)).toBe(425);
    expect(n(r.batch.weightLossPercent)).toBe(15);
    // DTR = 發展期 120s ÷ 總時間 600s = 20%
    expect(n(r.batch.dtrPercent)).toBe(20);
    // 熟豆成本 = 500g × 0.6 元/g ÷ 425g
    expect(D(r.roastedUnitCost).toFixed(4)).toBe(D(300).div(425).toFixed(4));
    await expectReconciled();
  });

  it("生豆不足時拒絕並回滾，不產生負庫存", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id, 300);
    await expect(roast(g.greenLot.id, f.roaster.id, 500, 425)).rejects.toThrow(/不足/);
    expect(n((await lotOf(g.lot.id)).onHand)).toBe(300);
    expect(await prisma.roastBatch.count()).toBe(0);
    await expectReconciled();
  });

  it("沒有事件時間時不計算 DTR（不偽計算）", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await withTx((tx) =>
      import("@/server/domain/roasting").then((m) =>
        m.createRoastBatch(tx, { greenLotId: g.greenLot.id, roasterId: f.roaster.id, roastedAt: new Date(), greenWeightG: 500, roastedWeightG: 430 }, actor),
      ),
    );
    expect(r.batch.dtrPercent).toBeNull();
    expect(r.batch.totalTimeSec).toBeNull();
  });
});

describe("Case 2：熟豆分裝", () => {
  it("425g 分裝 4 包 ×100g + 損耗 3g → 剩 22g、成品 +4、包材扣除、可追溯", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.greenLot.id, f.roaster.id, 500, 425);
    const res = await packageUnits(r.roastedLot.id, f.v100.id, 4, 3);

    expect(n((await lotOf(r.roastedLot.id)).onHand)).toBe(22);
    expect(n((await lotOf(r.roastedLot.id)).reserved)).toBe(0);
    expect(n((await lotOf(res.lot.id)).onHand)).toBe(4);
    const bagLot = await prisma.inventoryLot.findUniqueOrThrow({ where: { lotCode: "BAG-100-L1" } });
    const lblLot = await prisma.inventoryLot.findUniqueOrThrow({ where: { lotCode: "LBL-01-L1" } });
    expect(n(bagLot.onHand)).toBe(46);
    expect(n(lblLot.onHand)).toBe(46);
    // 成本 = 403g × 熟豆單價 + 4×5 + 4×1
    const expected = D(403).mul(D(300).div(425)).add(24);
    expect(D(res.totalCost).toFixed(1)).toBe(expected.toFixed(1));
    // 追溯
    const pkLot = await prisma.inventoryLot.findUniqueOrThrow({
      where: { id: res.lot.id },
      include: { packagingBatch: { include: { productionOrder: { include: { sourceLot: { include: { roastBatch: true } } } } } } },
    });
    expect(pkLot.packagingBatch?.productionOrder.sourceLot.roastBatch?.batchNo).toBe(r.batch.batchNo);
    await expectReconciled();
  });

  it("包材不足時整個分裝交易回滾", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id, 10000);
    const r = await roast(g.greenLot.id, f.roaster.id, 1000, 850);
    await expect(packageUnits(r.roastedLot.id, f.v100.id, 8)).resolves.toBeTruthy();
    // 再分裝 60 包：包材只剩 42 → 失敗
    await expect(packageUnits(r.roastedLot.id, f.v100.id, 60)).rejects.toThrow();
    expect(n((await lotOf(r.roastedLot.id)).onHand)).toBe(50);
    expect(n((await lotOf(r.roastedLot.id)).reserved)).toBe(0);
    expect(await prisma.packagingBatch.count()).toBe(1);
    await expectReconciled();
  });

  it("濾掛可自訂填充重量", async () => {
    const f = await baseFixture();
    const drip = await prisma.product.create({ data: { code: "P-DRIP", name: "濾掛", category: "DRIP_BAG", coffeeId: f.coffee.id } });
    const vd = await prisma.productVariant.create({ data: { productId: drip.id, sku: "DRIP-1", name: "單包", listPrice: 40, salePrice: 40 } });
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.greenLot.id, f.roaster.id, 500, 425);
    await withTx(async (tx) => {
      const po = await (await import("@/server/domain/production")).createProductionOrder(
        tx,
        { sourceLotId: r.roastedLot.id, targetVariantId: vd.id, plannedQty: 10, fillWeightG: 11.5, plannedDate: new Date("2026-11-21T00:00:00Z") },
        actor,
      );
      await completeProductionOrder(tx, po.id, { actualQty: 10 }, actor);
    });
    expect(n((await lotOf(r.roastedLot.id)).onHand)).toBe(310);
  });
});

describe("Case 3：訂單保留與並行", () => {
  it("4 包庫存，兩筆並行各訂 3 包：只能成功一筆，不超賣", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.greenLot.id, f.roaster.id, 500, 425);
    const pk = await packageUnits(r.roastedLot.id, f.v100.id, 4);

    const results = await Promise.allSettled([order(f.v100.id, 3), order(f.v100.id, 3)]);
    const ok = results.filter((x) => x.status === "fulfilled");
    const fail = results.filter((x) => x.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(fail).toHaveLength(1);
    expect(String((fail[0] as PromiseRejectedResult).reason.message)).toMatch(/不可超賣|不足/);

    const lot = await lotOf(pk.lot.id);
    expect(n(lot.onHand)).toBe(4);
    expect(n(lot.reserved)).toBe(3);
    expect(await prisma.salesOrder.count()).toBe(1);
    await expectReconciled();
  });

  it("多筆並行小訂單總保留量不超過庫存", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.greenLot.id, f.roaster.id, 1000, 850);
    const pk = await packageUnits(r.roastedLot.id, f.v100.id, 5);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => order(f.v100.id, 1)));
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(5);
    expect(n((await lotOf(pk.lot.id)).reserved)).toBe(5);
    await expectReconciled();
  });

  it("相同 idempotencyKey 重送不會重複建立訂單", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.greenLot.id, f.roaster.id, 500, 425);
    await packageUnits(r.roastedLot.id, f.v100.id, 4);
    const a = await order(f.v100.id, 1, "web-123");
    const b = await order(f.v100.id, 1, "web-123");
    expect(b.duplicate).toBe(true);
    expect(b.order.id).toBe(a.order.id);
    expect(await prisma.salesOrder.count()).toBe(1);
  });
});

describe("Case 4：重複確認付款", () => {
  it("重複按確認付款只記錄一次，不扣庫存、不產生出貨", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.greenLot.id, f.roaster.id, 500, 425);
    const pk = await packageUnits(r.roastedLot.id, f.v100.id, 4);
    const { order: o } = await order(f.v100.id, 2);

    const results = await Promise.all([
      withTx((tx) => confirmPayment(tx, o.id, { reference: "末五碼 12345" }, actor)),
      withTx((tx) => confirmPayment(tx, o.id, { reference: "末五碼 12345" }, actor)),
      withTx((tx) => confirmPayment(tx, o.id, {}, actor)),
    ]);
    expect(results.filter((x) => !x.alreadyPaid)).toHaveLength(1);
    expect(await prisma.paymentRecord.count({ where: { orderId: o.id } })).toBe(1);
    expect(await prisma.shipment.count()).toBe(0);
    const lot = await lotOf(pk.lot.id);
    expect(n(lot.onHand)).toBe(4);
    expect(n(lot.reserved)).toBe(2);
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus).toBe("PAID");
    await expectReconciled();
  });

  it("重複出貨被拒絕，不重複扣帳", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.greenLot.id, f.roaster.id, 500, 425);
    const pk = await packageUnits(r.roastedLot.id, f.v100.id, 4);
    const { order: o } = await order(f.v100.id, 2);
    await withTx((tx) => confirmPayment(tx, o.id, {}, actor));
    const results = await Promise.allSettled([
      withTx((tx) => shipOrder(tx, o.id, { trackingNo: "A1" }, actor)),
      withTx((tx) => shipOrder(tx, o.id, { trackingNo: "A1" }, actor)),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const lot = await lotOf(pk.lot.id);
    expect(n(lot.onHand)).toBe(2);
    expect(n(lot.reserved)).toBe(0);
    expect(await prisma.inventoryTransaction.count({ where: { type: "SHIPMENT_ISSUE" } })).toBe(1);
    await expectReconciled();
  });
});

describe("Case 5：取消訂單", () => {
  it("取消未出貨訂單：釋放保留、恢復可售量、保留歷史", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.greenLot.id, f.roaster.id, 500, 425);
    const pk = await packageUnits(r.roastedLot.id, f.v100.id, 4);
    const { order: o } = await order(f.v100.id, 3);
    expect(n((await lotOf(pk.lot.id)).reserved)).toBe(3);

    await withTx((tx) => cancelOrder(tx, o.id, { reason: "顧客取消" }, actor));
    const lot = await lotOf(pk.lot.id);
    expect(n(lot.reserved)).toBe(0);
    expect(n(lot.onHand)).toBe(4);
    const resv = await prisma.inventoryReservation.findMany({ where: { lotId: pk.lot.id } });
    expect(resv).toHaveLength(1);
    expect(resv[0].status).toBe("RELEASED");
    const alloc = await prisma.orderBatchAllocation.findMany({ where: { orderItem: { orderId: o.id } } });
    expect(alloc[0].status).toBe("RELEASED");
    // 可再被其他訂單保留
    await expect(order(f.v100.id, 4)).resolves.toBeTruthy();
    await expectReconciled();
  });

  it("已出貨訂單不可取消", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.greenLot.id, f.roaster.id, 500, 425);
    await packageUnits(r.roastedLot.id, f.v100.id, 4);
    const { order: o } = await order(f.v100.id, 1);
    await withTx((tx) => confirmPayment(tx, o.id, {}, actor));
    await withTx((tx) => shipOrder(tx, o.id, {}, actor));
    await expect(withTx((tx) => cancelOrder(tx, o.id, {}, actor))).rejects.toThrow(/退貨/);
  });
});

describe("Case 6：接單後分裝", () => {
  it("無 200g 現貨 → 待分裝、預留熟豆、完成後分配給訂單、熟豆不重複使用", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.greenLot.id, f.roaster.id, 500, 425);

    const { order: o } = await order(f.v200.id, 2); // 需 400g
    expect(o.fulfillmentStatus).toBe("AWAITING_PACKAGING");
    const po = await prisma.productionOrder.findFirstOrThrow({ where: { salesOrderItem: { orderId: o.id } } });
    expect(po.mode).toBe("MADE_TO_ORDER");
    expect(n((await lotOf(r.roastedLot.id)).reserved)).toBe(400);

    // 熟豆已預留：其他分裝單或訂單無法再使用這 400g
    await expect(packageUnits(r.roastedLot.id, f.v100.id, 1)).rejects.toThrow(/不足/);
    await expect(order(f.v200.id, 1)).rejects.toThrow(/無法接單後分裝|不足/);

    await withTx((tx) => completeProductionOrder(tx, po.id, { actualQty: 2, lossG: 2 }, actor));
    const after = await prisma.salesOrder.findUniqueOrThrow({ where: { id: o.id }, include: { items: { include: { allocations: true } } } });
    expect(after.fulfillmentStatus).toBe("READY_TO_SHIP");
    expect(after.items[0].allocations).toHaveLength(1);
    expect(n(after.items[0].allocations[0].quantity)).toBe(2);
    expect(after.items[0].costSnapshot).not.toBeNull();
    const roasted = await lotOf(r.roastedLot.id);
    expect(n(roasted.onHand)).toBe(23);
    expect(n(roasted.reserved)).toBe(0);
    // 成品全部保留給此訂單
    const fg = await lotOf(after.items[0].allocations[0].lotId);
    expect(n(fg.onHand)).toBe(2);
    expect(n(fg.reserved)).toBe(2);
    await expectReconciled();
  });

  it("取消接單後分裝訂單：取消生產單並釋放熟豆預留", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.greenLot.id, f.roaster.id, 500, 425);
    const { order: o } = await order(f.v200.id, 1);
    await withTx((tx) => cancelOrder(tx, o.id, {}, actor));
    expect(n((await lotOf(r.roastedLot.id)).reserved)).toBe(0);
    expect((await prisma.productionOrder.findFirstOrThrow()).status).toBe("CANCELLED");
    await expectReconciled();
  });
});

describe("Case 7：歷史成本快照", () => {
  it("完成訂單後調整生豆成本與售價，舊訂單快照不變，新交易使用新成本", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id, 5000, 600);
    const r1 = await roast(g.greenLot.id, f.roaster.id, 500, 425);
    await packageUnits(r1.roastedLot.id, f.v100.id, 4);
    const { order: o } = await order(f.v100.id, 2);
    await withTx((tx) => confirmPayment(tx, o.id, {}, actor));
    await withTx((tx) => shipOrder(tx, o.id, {}, actor));
    const before = await prisma.salesOrder.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });

    await withTx((tx) => correctGreenCost(tx, g.greenLot.id, { unitPricePerKg: 1200, reason: "供應商補開發票" }, actor));
    await prisma.productVariant.update({ where: { id: f.v100.id }, data: { salePrice: 520 } });

    const after = await prisma.salesOrder.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
    expect(after.total.toString()).toBe(before.total.toString());
    expect(after.items[0].unitPriceSnapshot.toString()).toBe("420");
    expect(after.items[0].costSnapshot?.toString()).toBe(before.items[0].costSnapshot?.toString());

    // 新烘焙使用新成本 1.2 元/g
    const r2 = await roast(g.greenLot.id, f.roaster.id, 500, 425);
    expect(D(r2.batch.greenCostTotal).toNumber()).toBe(600);
    const { order: o2 } = await withTx((tx) =>
      createOrder(tx, { customerName: "B", items: [{ variantId: f.v100.id, quantity: 1 }] }, actor),
    );
    const o2i = await prisma.salesOrderItem.findFirstOrThrow({ where: { orderId: o2.id } });
    expect(o2i.unitPriceSnapshot.toString()).toBe("520");
  });
});

describe("Case 8：退貨", () => {
  it("出貨後退貨進入待檢，不增加可售；檢查後才重新入庫", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.greenLot.id, f.roaster.id, 500, 425);
    const pk = await packageUnits(r.roastedLot.id, f.v100.id, 4);
    const { order: o } = await order(f.v100.id, 2);
    await withTx((tx) => confirmPayment(tx, o.id, {}, actor));
    await withTx((tx) => shipOrder(tx, o.id, {}, actor));
    expect(n((await lotOf(pk.lot.id)).onHand)).toBe(2);

    const alloc = await prisma.orderBatchAllocation.findFirstOrThrow({ where: { orderItem: { orderId: o.id } } });
    const rr = await withTx((tx) => createReturn(tx, o.id, { reason: "包裝破損", items: [{ allocationId: alloc.id, quantity: 2 }] }, actor));
    // 可售不變
    const fgLot = await lotOf(pk.lot.id);
    expect(n(fgLot.onHand)).toBe(2);
    const items = await prisma.returnItem.findMany({ where: { returnId: rr.id } });
    const q = await lotOf(items[0].quarantineLotId);
    expect(q.status).toBe("QUARANTINE");
    expect(n(q.onHand)).toBe(2);
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: o.id } })).fulfillmentStatus).toBe("RETURN_PROCESSING");

    // 不可退超過出貨量
    await expect(withTx((tx) => createReturn(tx, o.id, { items: [{ allocationId: alloc.id, quantity: 1 }] }, actor))).rejects.toThrow(/超過/);

    await withTx((tx) => inspectReturnItem(tx, items[0].id, "RESTOCK", actor));
    expect(n((await lotOf(pk.lot.id)).onHand)).toBe(4);
    expect(n((await lotOf(items[0].quarantineLotId)).onHand)).toBe(0);
    await expect(withTx((tx) => inspectReturnItem(tx, items[0].id, "RESTOCK", actor))).rejects.toThrow(/已檢查/);
    expect((await prisma.returnRecord.findUniqueOrThrow({ where: { id: rr.id } })).status).toBe("COMPLETED");
    await expectReconciled();
  });
});

describe("Case 9：曲線匯入", () => {
  it("合法 CSV：自動對應欄位、預覽、匯入、保存雜湊、計算 RoR", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.greenLot.id, f.roaster.id, 500, 425);
    const text = fixture("curve-valid.csv");
    const { headers } = preprocessCsv(text);
    const mapping = detectMapping(headers);
    expect(mapping).toMatchObject({ time: "time", bt: "BT", et: "ET" });
    const parsed = parseCsvCurve(text, mapping);
    expect(parsed.points.length).toBe(21);
    expect(parsed.rorComputed).toBe(true);
    expect(parsed.points.at(-1)!.rorC).not.toBeNull();

    const curve = await withTx((tx) => saveCurve(tx, { roastBatchId: r.batch.id, source: "CSV", fileName: "curve-valid.csv", fileSha256: sha256(text), mapping, parsed }, actor));
    expect(await prisma.roastCurvePoint.count({ where: { curveId: curve.id } })).toBe(21);

    // 重複匯入同一檔案 → 拒絕
    await expect(
      withTx((tx) => saveCurve(tx, { roastBatchId: r.batch.id, source: "CSV", fileName: "x.csv", fileSha256: sha256(text), mapping, parsed }, actor)),
    ).rejects.toThrow(/重複匯入/);
  });

  it("錯誤格式給出具體行號提示", () => {
    const text = fixture("curve-invalid.csv");
    try {
      parseCsvCurve(text, { time: "time", bt: "BT", et: "ET" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CurveParseError);
      const msgs = (e as CurveParseError).errors.join("\n");
      expect(msgs).toMatch(/第 4 行：時間 .* 未遞增/);
      expect(msgs).toMatch(/第 5 行：豆溫 BT「abc」不是數字/);
      expect(msgs).toMatch(/第 6 行：BT 520°C 超出合理範圍/);
    }
  });

  it("Artisan .alog：解析 timex/temp1/temp2 與 timeindex 事件", () => {
    const parsed = parseArtisanAlog(fixture("sample.alog"));
    expect(parsed.points[0].timeSec).toBe(0);
    expect(parsed.points[0].btC).toBe(200);
    expect(parsed.points[0].etC).toBe(220);
    expect(parsed.events.map((e) => e.type)).toEqual(["CHARGE", "DRY_END", "FC_START", "DROP"]);
    expect(parsed.events.find((e) => e.type === "DROP")!.timeSec).toBe(540);
  });
});

describe("Case 10：全流程追溯", () => {
  it("已出貨訂單 → SKU → 包裝批次 → 烘焙批次 → 生豆批次，數量一致、無個資", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.greenLot.id, f.roaster.id, 500, 425);
    const pk = await packageUnits(r.roastedLot.id, f.v100.id, 4, 3);
    const { order: o } = await withTx((tx) =>
      createOrder(tx, { customerName: "王小明", customerPhone: "0912345678", shippingAddress: "臺北市", items: [{ variantId: f.v100.id, quantity: 2 }] }, actor),
    );
    await withTx((tx) => confirmPayment(tx, o.id, {}, actor));
    await withTx((tx) => shipOrder(tx, o.id, {}, actor));

    const t = await traceOrder(o.id);
    const a = t.order.items[0].allocations[0];
    expect(t.order.items[0].skuSnapshot).toBe("YRG-100");
    expect(a.lot.packagingBatch?.batchNo).toBe(pk.packagingBatch.batchNo);
    const rb = a.lot.packagingBatch!.productionOrder.sourceLot.roastBatch!;
    expect(rb.batchNo).toBe(r.batch.batchNo);
    expect(rb.greenLot.lotCode).toBe(g.greenLot.lotCode);
    expect(t.checks[0]).toEqual({ sku: "YRG-100", ordered: 2, allocated: "2" });
    // 成本來源
    expect(D(a.unitCost).toFixed(4)).toBe(D(pk.unitCost).toFixed(4));
    expect(D(t.order.items[0].costSnapshot!).toFixed(2)).toBe(D(pk.unitCost).mul(2).toFixed(2));
    const json = JSON.stringify(t);
    expect(json).not.toMatch(/王小明|0912345678|臺北市/);
  });
});

describe("帳本完整性", () => {
  it("帳本不可修改或刪除（DB trigger）", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const tx1 = await prisma.inventoryTransaction.findFirstOrThrow({ where: { lotId: g.lot.id } });
    await expect(prisma.inventoryTransaction.update({ where: { id: tx1.id }, data: { quantity: 1 } })).rejects.toThrow(/ledger_immutable/);
    await expect(prisma.inventoryTransaction.delete({ where: { id: tx1.id } })).rejects.toThrow(/ledger_immutable/);
  });

  it("DB CHECK 防止負庫存（即使繞過服務層）", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id, 100);
    await expect(prisma.inventoryLot.update({ where: { id: g.lot.id }, data: { onHand: -1 } })).rejects.toThrow(/lot_onhand_nonneg/);
  });

  it("手動異動與沖銷：杯測耗用 −20g 後沖銷，餘額回復且原交易保留", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const r = await roast(g.greenLot.id, f.roaster.id, 500, 425);
    const t = await withTx((tx) => manualAdjust(tx, { lotId: r.roastedLot.id, type: "CUPPING_USE", quantity: -20, actor }));
    expect(n((await lotOf(r.roastedLot.id)).onHand)).toBe(405);
    await withTx((tx) => reverseTransaction(tx, t.id, actor, "誤記"));
    expect(n((await lotOf(r.roastedLot.id)).onHand)).toBe(425);
    await expect(withTx((tx) => reverseTransaction(tx, t.id, actor, "再次"))).rejects.toThrow(/已被沖銷/);
    expect(await prisma.inventoryTransaction.count({ where: { lotId: r.roastedLot.id } })).toBe(3);
    await expectReconciled();
  });
});
