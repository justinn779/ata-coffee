"use server";

import { z } from "zod";
import { withTx } from "@/lib/db";
import { optDate, optDec, optStr, reqDate, reqId, reqInt } from "@/lib/zod";
import { action } from "@/server/action";
import { cancelProductionOrder, completeProductionOrder, createProductionOrder } from "@/server/domain/production";

export const createPO = action(
  z.object({
    sourceLotId: reqId("熟豆批次"),
    targetVariantId: reqId("目標 SKU"),
    plannedQty: reqInt("預計生產數量"),
    fillWeightG: optDec("單包重量", { min: 0 }),
    plannedDate: reqDate("生產日期"),
    note: optStr(),
  }),
  async (i, actor) => {
    const po = await withTx((tx) => createProductionOrder(tx, { ...i, mode: "PRE_PACK" }, actor));
    return { id: po.id, redirect: `/production/${po.id}` };
  },
  { revalidate: ["/production", "/inventory", "/"] },
);

export const completePO = action(
  z.object({
    id: reqId("生產單"),
    actualQty: reqInt("實際生產數量"),
    lossG: optDec("損耗", { min: 0 }),
    laborCost: optDec("包裝人工", { min: 0 }),
    qualityStatus: z.enum(["PASS", "HOLD", "FAIL"]).default("PASS"),
    expiryDate: optDate(),
    note: optStr(),
  }),
  async ({ id, ...i }, actor) => {
    const r = await withTx((tx) => completeProductionOrder(tx, id, { ...i, lossG: i.lossG ?? 0, laborIsEstimate: true }, actor));
    return { ok: true as const, message: `完成分裝 ${r.packagingBatch.batchNo}，每件成本 NT$${r.unitCost.toFixed(2)}` };
  },
  { revalidate: ["/production", "/inventory", "/orders", "/"] },
);

export const cancelPO = action(z.object({ id: reqId("生產單"), reason: optStr(300) }), async ({ id, reason }, actor) => {
  await withTx((tx) => cancelProductionOrder(tx, id, actor, { reason: reason ?? undefined }));
  return { ok: true as const, message: "已取消並釋放熟豆預留" };
}, { revalidate: ["/production", "/inventory"] });

