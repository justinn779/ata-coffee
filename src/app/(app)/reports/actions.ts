"use server";

import { z } from "zod";
import { withTx } from "@/lib/db";
import { boolStr, optStr, reqDate, reqDec, reqStr } from "@/lib/zod";
import { action } from "@/server/action";
import { audit } from "@/server/domain/audit";

export const addPeriodExpense = action(
  z.object({ amount: reqDec("金額", { positive: true }), occurredOn: reqDate("日期"), isEstimate: boolStr(), calcNote: reqStr("項目說明", 300) }),
  async (i, actor) => {
    await withTx(async (tx) => {
      const c = await tx.costEntry.create({ data: { category: "OPERATING_EXPENSE", target: "PERIOD", ...i } });
      await audit(tx, actor, "cost.period", "CostEntry", c.id, `營運費用 ${i.amount}：${i.calcNote}`);
    });
    return { ok: true as const, message: "已新增期間營運費用" };
  },
  { revalidate: ["/reports", "/"] },
);

export const addAllocationRule = action(
  z.object({
    name: reqStr("規則名稱", 100),
    category: z.enum(["ROAST_ENERGY", "ROAST_LABOR", "PACKAGING_LABOR", "CONSUMABLES", "SHIPPING", "PLATFORM_FEE", "PAYMENT_FEE", "ORDER_OTHER", "OPERATING_EXPENSE"]),
    method: z.enum(["PER_BATCH", "PER_KG_GREEN", "PER_UNIT", "PERCENT_OF_REVENUE"]),
    rate: reqDec("費率", { min: 0 }),
    description: optStr(500),
  }),
  async (i, actor) => {
    await withTx(async (tx) => {
      const r = await tx.costAllocationRule.create({ data: i });
      await audit(tx, actor, "cost.rule", "CostAllocationRule", r.id, `成本分攤規則 ${i.name}`);
    });
    return { ok: true as const, message: "已新增成本分攤規則" };
  },
  { revalidate: ["/reports"] },
);
