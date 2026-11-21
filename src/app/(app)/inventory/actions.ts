"use server";

import { z } from "zod";
import { withTx } from "@/lib/db";
import { D } from "@/lib/decimal";
import { DomainError } from "@/lib/errors";
import { enumList, optStr, reqDec, reqId, reqStr } from "@/lib/zod";
import { action } from "@/server/action";
import { audit } from "@/server/domain/audit";
import { createLot, ensureMaterialItem, manualAdjust, MANUAL_TX_TYPES, post, reverseTransaction } from "@/server/domain/inventory";
import { nextNumber } from "@/server/domain/sequence";

export const adjustLot = action(
  z.object({
    lotId: reqId("批次"),
    type: enumList(MANUAL_TX_TYPES, "異動類型"),
    direction: z.enum(["out", "in"]).default("out"),
    quantity: reqDec("數量", { positive: true }),
    note: optStr(500),
    idempotencyKey: z.string().max(100).optional(),
  }),
  async (i, actor) => {
    const q = D(i.quantity);
    const signed = i.type === "ADJUSTMENT" && i.direction === "in" ? q : q.neg();
    await withTx((tx) => manualAdjust(tx, { lotId: i.lotId, type: i.type, quantity: signed, note: i.note ?? undefined, actor, idempotencyKey: i.idempotencyKey }));
    return { ok: true as const, message: "庫存異動已過帳" };
  },
  { revalidate: ["/inventory", "/"] },
);

export const reverseTx = action(z.object({ txId: reqId("交易"), note: reqStr("沖銷原因") }), async ({ txId, note }, actor) => {
  await withTx((tx) => reverseTransaction(tx, txId, actor, note));
  return { ok: true as const, message: "已建立沖銷交易（原交易保留）" };
}, { revalidate: ["/inventory"] });

export const receiveMaterial = action(
  z.object({ materialId: reqId("包材"), quantity: reqDec("數量", { positive: true }), unitCost: reqDec("單位成本", { min: 0 }), note: optStr(500) }),
  async (i, actor) => {
    const lot = await withTx(async (tx) => {
      const item = await ensureMaterialItem(tx, i.materialId);
      const m = await tx.material.findUniqueOrThrow({ where: { id: i.materialId } });
      const lot = await createLot(tx, { itemId: item.id, lotCode: await nextNumber(tx, `MT-${m.code}`), unitCost: i.unitCost, producedAt: new Date() });
      await post(tx, { lotId: lot.id, type: "RECEIPT", quantity: i.quantity, actor, note: i.note ?? "包材入庫", refType: "Material", refId: m.id });
      await audit(tx, actor, "material.receive", "Material", m.id, `包材入庫 ${m.name} × ${i.quantity}`);
      return lot;
    });
    return { id: lot.id, redirect: `/inventory/lots/${lot.id}` };
  },
  { revalidate: ["/inventory"] },
);

export const setLotStatus = action(z.object({ lotId: reqId("批次"), status: z.enum(["AVAILABLE", "HOLD"]), note: reqStr("原因") }), async (i, actor) => {
  await withTx(async (tx) => {
    const lot = await tx.inventoryLot.findUniqueOrThrow({ where: { id: i.lotId } });
    if (lot.status === "QUARANTINE") throw new DomainError("待檢批次請由退貨檢查流程處理");
    if (i.status === "HOLD" && D(lot.reserved).gt(0)) throw new DomainError("批次仍有保留量，無法改為品質保留");
    await tx.inventoryLot.update({ where: { id: lot.id }, data: { status: i.status } });
    await audit(tx, actor, "lot.status", "InventoryLot", lot.id, `${lot.status} → ${i.status}：${i.note}`);
  });
  return { ok: true as const, message: "批次狀態已更新" };
}, { revalidate: ["/inventory"] });

export const setThreshold = action(z.object({ itemId: reqId("品項"), threshold: reqDec("預警數量", { min: 0 }) }), async (i, actor) => {
  await withTx(async (tx) => {
    await tx.inventoryItem.update({ where: { id: i.itemId }, data: { lowStockThreshold: i.threshold } });
    await audit(tx, actor, "item.threshold", "InventoryItem", i.itemId, `預警數量 ${i.threshold}`);
  });
  return { ok: true as const, message: "已更新預警設定" };
}, { revalidate: ["/inventory", "/"] });
