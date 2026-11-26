/**
 * 編號自動產生：新增時不填編號，系統依類別產生（CF-001、P-001、SKU-001…）；修改時沿用原本的編號。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { C } from "../../functions/src/types";
import { docs, op, resetDb } from "../helpers";

beforeEach(async () => {
  await resetDb();
});

const codeOf = async (col: string, id: string, field = "code") => (await docs(col)).find((x) => x.id === id)![field];

describe("編號自動產生", () => {
  it("咖啡豆、供應商、儲位、包材、系列、商品、品項都不用填編號", async () => {
    const c1 = await op<{ id: string }>("coffee.save", { nameZh: "豆子一" });
    const c2 = await op<{ id: string }>("coffee.save", { nameZh: "豆子二" });
    expect(await codeOf(C.coffees, c1.id)).toBe("CF-001");
    expect(await codeOf(C.coffees, c2.id)).toBe("CF-002");
    // 修改時沒填編號：沿用原本的
    await op("coffee.save", { id: c1.id, nameZh: "豆子一改名" });
    expect(await codeOf(C.coffees, c1.id)).toBe("CF-001");

    const sup = await op<{ id: string }>("supplier.save", { name: "供應商" });
    expect(await codeOf(C.suppliers, sup.id)).toBe("SUP-001");
    const loc = await op<{ id: string }>("location.save", { name: "倉庫" });
    expect(await codeOf(C.locations, loc.id)).toBe("L-001");
    const mat = await op<{ id: string }>("material.save", { name: "袋子", category: "BAG" });
    expect(await codeOf(C.materials, mat.id)).toBe("M-001");
    const ser = await op<{ id: string }>("series.save", { name: "系列", character: "NONE" });
    expect(await codeOf(C.series, ser.id)).toBe("S-001");
    const p = await op<{ id: string }>("product.save", { name: "商品", category: "COFFEE_BEAN", coffeeId: c1.id, status: "ACTIVE" });
    expect(await codeOf(C.products, p.id)).toBe("P-001");
    const v = await op<{ id: string }>("variant.save", { productId: p.id, name: "100g", listPrice: "450", salePrice: "420", fillWeightG: "100", stockPolicy: "STOCK_ONLY", status: "ACTIVE", materials: [] });
    expect(await codeOf(C.variants, v.id, "sku")).toBe("SKU-001");
  });

  it("以前手動取過的編號會略過", async () => {
    await op("coffee.save", { code: "CF-001", nameZh: "手動編號" });
    const c = await op<{ id: string }>("coffee.save", { nameZh: "自動編號" });
    expect(await codeOf(C.coffees, c.id)).toBe("CF-002");
  });
});
