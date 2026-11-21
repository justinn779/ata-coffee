"use server";

import { z } from "zod";
import { withTx } from "@/lib/db";
import { optId, optInt, optStr, reqStr, optDec, reqDec, reqId, reqDate, reqDateTime } from "@/lib/zod";
import { action } from "@/server/action";
import { audit } from "@/server/domain/audit";
import { receiveGreenPurchase, correctGreenCost } from "@/server/domain/green";

const coffeeSchema = z.object({
  id: optId(),
  code: reqStr("代碼", 40),
  nameZh: reqStr("中文名稱"),
  nameEn: optStr(200),
  brandName: optStr(200),
  country: optStr(100),
  region: optStr(100),
  farm: optStr(200),
  producer: optStr(200),
  variety: optStr(200),
  process: optStr(100),
  altitude: optStr(100),
  grade: optStr(100),
  supplierId: optId(),
  originFlavorNotes: optStr(),
  note: optStr(),
  restStartDays: optInt("建議養豆開始天數", 0, 365),
  peakFromDays: optInt("最佳飲用起始天數", 0, 365),
  peakToDays: optInt("最佳飲用結束天數", 0, 365),
  shelfLifeDays: optInt("預設保存期限", 1, 3650),
  freshnessNote: optStr(),
});

export const saveCoffee = action(
  coffeeSchema,
  async ({ id, ...data }, actor) => {
    if (data.peakFromDays != null && data.peakToDays != null && data.peakToDays < data.peakFromDays) {
      return { ok: false as const, error: "最佳飲用區間結束天數不可早於起始天數", fieldErrors: { peakToDays: "需大於起始天數" } };
    }
    const saved = await withTx(async (tx) => {
      const c = id ? await tx.coffee.update({ where: { id }, data }) : await tx.coffee.create({ data });
      await audit(tx, actor, id ? "coffee.update" : "coffee.create", "Coffee", c.id, `${id ? "更新" : "新增"}咖啡豆 ${c.nameZh}`);
      return c;
    });
    return { id: saved.id, redirect: `/coffees/${saved.id}` };
  },
  { revalidate: ["/coffees"] },
);

export const archiveCoffee = action(z.object({ id: reqId("咖啡豆") }), async ({ id }, actor) => {
  await withTx(async (tx) => {
    const c = await tx.coffee.findUniqueOrThrow({ where: { id } });
    await tx.coffee.update({ where: { id }, data: { archivedAt: c.archivedAt ? null : new Date() } });
    await audit(tx, actor, "coffee.archive", "Coffee", id, c.archivedAt ? "取消封存" : "封存");
  });
}, { revalidate: ["/coffees"] });

const greenSchema = z.object({
  coffeeId: reqId("咖啡豆"),
  supplierId: optId(),
  purchaseDate: reqDate("採購日期"),
  receivedAt: reqDateTime("入庫時間"),
  invoiceNo: optStr(100),
  lotCode: optStr(60),
  purchasedWeightG: reqDec("採購數量", { positive: true }),
  receivedWeightG: reqDec("實際入庫數量", { positive: true }),
  unitPricePerKg: reqDec("每公斤單價", { min: 0 }),
  shippingCost: optDec("運費", { min: 0 }),
  otherCost: optDec("其他費用", { min: 0 }),
  moisturePercent: optDec("含水率", { min: 0 }),
  densityGPerL: optDec("密度", { min: 0 }),
  waterActivity: optDec("水活性", { min: 0 }),
  locationId: optId(),
  note: optStr(),
});

export const receiveGreen = action(
  greenSchema,
  async (input, actor) => {
    const r = await withTx((tx) => receiveGreenPurchase(tx, { ...input, shippingCost: input.shippingCost ?? 0, otherCost: input.otherCost ?? 0 }, actor));
    return { id: r.greenLot.id, redirect: `/inventory/lots/${r.lot.id}` };
  },
  { revalidate: ["/green", "/inventory", "/"] },
);

export const correctCost = action(
  z.object({ greenLotId: reqId("生豆批次"), unitPricePerKg: reqDec("每公斤單價", { min: 0 }), shippingCost: optDec("運費", { min: 0 }), otherCost: optDec("其他費用", { min: 0 }), reason: reqStr("更正原因") }),
  async (i, actor) => {
    const c = await withTx((tx) => correctGreenCost(tx, i.greenLotId, { unitPricePerKg: i.unitPricePerKg, shippingCost: i.shippingCost ?? undefined, otherCost: i.otherCost ?? undefined, reason: i.reason }, actor));
    return { ok: true as const, message: `已更正，新每克成本 NT$${c.perG.toFixed(4)}；歷史批次與訂單成本不變` };
  },
  { revalidate: ["/green", "/inventory"] },
);

