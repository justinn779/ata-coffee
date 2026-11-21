"use server";

import { z } from "zod";
import { withTx } from "@/lib/db";
import { bool, optDate, optId, optStr, reqId, reqStr } from "@/lib/zod";
import { action } from "@/server/action";
import { audit } from "@/server/domain/audit";

export const saveSeries = action(
  z.object({
    id: optId(),
    code: reqStr("系列編號", 40),
    name: reqStr("系列名稱", 100),
    story: optStr(),
    flavorNotes: optStr(),
    character: z.enum(["NONE", "ATI", "ATO", "BOTH"]),
    isLimited: bool(),
    launchDate: optDate(),
    recommendedRecipeId: optId(),
  }),
  async ({ id, ...data }, actor) => {
    const s = await withTx(async (tx) => {
      const s = id ? await tx.brandSeries.update({ where: { id }, data }) : await tx.brandSeries.create({ data });
      await audit(tx, actor, id ? "series.update" : "series.create", "BrandSeries", s.id, `${s.code} ${s.name}`);
      return s;
    });
    return { id: s.id, redirect: `/series/${s.id}` };
  },
  { revalidate: ["/series"] },
);

export const toggleTracePublish = action(z.object({ id: reqId("履歷"), recommendedBrew: optStr(300) }), async ({ id, recommendedBrew }, actor) => {
  await withTx(async (tx) => {
    const t = await tx.productTraceability.findUniqueOrThrow({ where: { id } });
    await tx.productTraceability.update({ where: { id }, data: { isPublished: !t.isPublished, recommendedBrew: recommendedBrew ?? t.recommendedBrew } });
    await audit(tx, actor, "trace.publish", "ProductTraceability", id, t.isPublished ? "取消發布" : "發布 QR 履歷");
  });
}, { revalidate: ["/series"] });
