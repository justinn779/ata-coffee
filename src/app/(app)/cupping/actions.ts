"use server";

import { z } from "zod";
import { withTx } from "@/lib/db";
import { bool, optDec, optStr, reqDateTime, reqId } from "@/lib/zod";
import { action } from "@/server/action";
import { createCupping } from "@/server/domain/lab";

export const saveCupping = action(
  z.object({
    roastBatchId: reqId("烘焙批次"),
    templateId: reqId("評分模板"),
    cuppedAt: reqDateTime("杯測時間"),
    grindSetting: optStr(100),
    doseG: optDec("粉量", { min: 0 }),
    waterG: optDec("水量", { min: 0 }),
    waterTempC: optDec("水溫", { min: 0 }),
    scores: z.record(optDec("分數", { min: 0 })).default({}),
    tags: optStr(500),
    defects: optStr(),
    description: optStr(),
    evaluator: optStr(100),
    consumedG: optDec("耗用量", { min: 0 }),
    deductStock: bool(),
  }),
  async (i, actor) => {
    const s = await withTx((tx) => createCupping(tx, i, actor));
    return { id: s.id, redirect: `/cupping/${s.id}` };
  },
  { revalidate: ["/cupping", "/roasting", "/inventory"] },
);
