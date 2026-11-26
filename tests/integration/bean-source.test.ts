/**
 * 從任意步驟開始：杯測、手沖可以不經過烘豆紀錄，直接記在咖啡豆上（樣品、外購熟豆）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { C } from "../../functions/src/types";
import { baseFixture, docs, expectReconciled, op, resetDb } from "../helpers";

beforeEach(async () => {
  await resetDb();
});

const tplOf = () => op<{ id: string }>("template.create", { name: "模板", scaleMin: "0", scaleMax: "10", step: "0.25", isDefault: "true", attributes: "aroma:香氣" });

describe("沒有烘豆紀錄的杯測／手沖", () => {
  it("杯測：只選咖啡豆即可；填烘焙日期才算烘後天數，可修改、刪除，不動庫存", async () => {
    const f = await baseFixture();
    const tpl = await tplOf();
    const c = await op<{ id: string }>("cupping.create", { coffeeId: f.coffee.id, templateId: tpl.id, cuppedAt: "2026-11-15T10:00", scores: { aroma: "8" }, consumedG: "10", deductStock: true });
    let s = (await docs(C.cuppings)).find((x) => x.id === c.id)!;
    expect(s.roastBatchId).toBeNull();
    expect(s.coffeeId).toBe(f.coffee.id);
    expect(s.batchNo).toBe("樣品");
    expect(s.restDays).toBeNull();
    expect(s.stockTxId).toBeNull();

    await op("cupping.update", { id: c.id, templateId: tpl.id, roastedDate: "2026-11-10", cuppedAt: "2026-11-15T10:00", scores: { aroma: "9" } });
    s = (await docs(C.cuppings)).find((x) => x.id === c.id)!;
    expect(s.restDays).toBe(5);
    expect(s.sampleRoastedDate).toBe("2026-11-10");
    // 杯測時間早於烘焙日期：只提醒，照樣存檔
    const w = await op<{ warnings?: string[] }>("cupping.update", { id: c.id, templateId: tpl.id, roastedDate: "2026-11-20", cuppedAt: "2026-11-15T10:00", scores: {} });
    expect(w.warnings?.join()).toMatch(/早於烘焙時間/);

    // 有紀錄的咖啡豆：刪除前先提醒
    await expect(op("master.delete", { col: C.coffees, id: f.coffee.id })).rejects.toThrow(/杯測紀錄/);
    await op("cupping.delete", { id: c.id });
    expect(await docs(C.cuppings)).toHaveLength(0);
    await expectReconciled();
  });

  it("手沖：只選咖啡豆即可、可修改；沒有豆子來源時拒絕", async () => {
    const f = await baseFixture();
    const b = await op<{ id: string }>("brew.create", { coffeeId: f.coffee.id, roastedDate: "2026-11-01", brewedAt: "2026-11-11T09:00", doseG: "15", waterG: "240" });
    let s = (await docs(C.brews)).find((x) => x.id === b.id)!;
    expect(s.restDays).toBe(10);
    expect(s.coffeeName).toBe("耶加雪菲 水洗");
    await op("brew.update", { id: b.id, roastedDate: "2026-11-01", brewedAt: "2026-11-11T09:00", doseG: "16", waterG: "240", rating: "8" });
    s = (await docs(C.brews)).find((x) => x.id === b.id)!;
    expect(s.doseG).toBe("16.00");
    expect(s.roastBatchId).toBeNull();
    await expect(op("brew.create", { brewedAt: "2026-11-11T09:00", doseG: "15", waterG: "240" })).rejects.toThrow(/烘焙批次|咖啡豆/);
    await op("brew.delete", { id: b.id });
    await expectReconciled();
  });
});
