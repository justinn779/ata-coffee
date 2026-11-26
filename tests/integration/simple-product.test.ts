/**
 * 簡化流程：新增商品時一次建好各規格；分裝一步完成（不用先建分裝單再完成）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { C } from "../../functions/src/types";
import { baseFixture, docs, expectReconciled, lotOf, n, op, receiveGreen, resetDb, roast } from "../helpers";

beforeEach(async () => {
  await resetDb();
});

describe("簡化的商品與分裝", () => {
  it("一次建立商品與兩種規格，預設上架、現貨、原價＝售價、包材各 1", async () => {
    const f = await baseFixture();
    const r = await op<{ id: string }>("product.quickCreate", {
      name: "瓜地馬拉",
      coffeeId: f.coffee.id,
      sizes: [
        { name: "100g", fillWeightG: "100", salePrice: "380", materialId: f.bag.id, materialId2: f.label.id },
        { name: "200g", fillWeightG: "200", salePrice: "700" },
      ],
    });
    const p = (await docs(C.products)).find((x) => x.id === r.id)!;
    expect(p.status).toBe("ACTIVE");
    expect(p.coffeeId).toBe(f.coffee.id);
    const vs = await docs(C.variants, "productId", r.id);
    expect(vs).toHaveLength(2);
    const v100 = vs.find((v) => v.name === "100g")!;
    expect(v100.listPrice).toBe(v100.salePrice);
    expect(v100.stockPolicy).toBe("STOCK_ONLY");
    expect((v100.materials as unknown[]).length).toBe(2);
    expect(String(v100.sku)).toMatch(/^SKU-/);
    await expect(op("product.quickCreate", { name: "空的", sizes: [] })).rejects.toThrow();
  });

  it("一步完成分裝：扣熟豆與包材、產出成品", async () => {
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id);
    const rb = await roast(g.id, f.roaster.id, 500, 425);
    const res = await op<{ id: string; message: string }>("production.quick", { sourceLotId: rb.roastedLotId, targetVariantId: f.v100.id, qty: "3", lossG: "5", packedDate: "2026-11-20" });
    expect(res.message).toMatch(/分裝完成/);
    const po = (await docs(C.productionOrders)).find((x) => x.id === res.id)!;
    expect(po.status).toBe("COMPLETED");
    expect(n((await lotOf(rb.roastedLotId)).onHand)).toBe(425 - 300 - 5);
    expect(n((await lotOf(rb.roastedLotId)).reserved)).toBe(0);
    expect(n((await lotOf(po.outputLotId as string)).onHand)).toBe(3);
    expect(n((await lotOf(f.bagLotId)).onHand)).toBe(47);
    expect(String(po.completedAt).slice(0, 10)).toBe("2026-11-20");
    await expectReconciled();
  });
});
