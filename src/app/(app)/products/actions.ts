"use server";

import { z } from "zod";
import { withTx } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { bool, optDate, optDec, optId, optStr, reqDec, reqStr } from "@/lib/zod";
import { action } from "@/server/action";
import { audit } from "@/server/domain/audit";
import { ensureVariantItem } from "@/server/domain/inventory";

export const saveProduct = action(
  z.object({
    id: optId(),
    code: reqStr("商品編號", 40),
    name: reqStr("商品名稱"),
    category: z.enum(["COFFEE_BEAN", "DRIP_BAG", "DRIP_BAG_SET", "GIFT_BOX", "MERCH", "OTHER"]),
    brandSeriesId: optId(),
    coffeeId: optId(),
    description: optStr(),
    flavorNotes: optStr(),
    status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]),
    isLimited: bool(),
    saleStartDate: optDate(),
    saleEndDate: optDate(),
  }),
  async ({ id, ...data }, actor) => {
    if (data.saleStartDate && data.saleEndDate && data.saleEndDate < data.saleStartDate) throw new DomainError("販售結束日期不可早於開始日期");
    const p = await withTx(async (tx) => {
      if (id) {
        const prev = await tx.product.findUniqueOrThrow({ where: { id } });
        if (prev.coffeeId && prev.coffeeId !== data.coffeeId) {
          const used = await tx.productionOrder.count({ where: { targetVariant: { productId: id } } });
          if (used) throw new DomainError("此商品已有分裝紀錄，不可更換對應咖啡豆（請建立新商品）");
        }
      }
      const p = id ? await tx.product.update({ where: { id }, data }) : await tx.product.create({ data });
      await audit(tx, actor, id ? "product.update" : "product.create", "Product", p.id, p.name);
      return p;
    });
    return { id: p.id, redirect: `/products/${p.id}` };
  },
  { revalidate: ["/products"] },
);

export const saveVariant = action(
  z.object({
    id: optId(),
    productId: z.string().uuid(),
    sku: reqStr("SKU", 60),
    name: reqStr("規格名稱"),
    listPrice: reqDec("原價", { min: 0 }),
    salePrice: reqDec("售價", { min: 0 }),
    standardCost: optDec("估計成本", { min: 0 }),
    fillWeightG: optDec("填充重量", { min: 0 }),
    isBundle: bool(),
    stockPolicy: z.enum(["STOCK_ONLY", "MADE_TO_ORDER", "NOT_TRACKED"]),
    status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]),
    materials: z.array(z.object({ materialId: z.string().uuid("請選擇包材"), quantityPerUnit: reqDec("每件用量", { positive: true }) })).default([]),
    components: z.array(z.object({ componentVariantId: z.string().uuid("請選擇組件"), quantity: reqDec("數量", { positive: true }) })).default([]),
  }),
  async ({ id, productId, materials, components, ...data }, actor) => {
    if (data.isBundle && !components.length) throw new DomainError("套組至少需要一個組件");
    if (data.isBundle && data.stockPolicy === "MADE_TO_ORDER") throw new DomainError("套組第一版僅支援現貨（組件須有庫存）");
    if (!data.isBundle && data.stockPolicy === "MADE_TO_ORDER" && !data.fillWeightG) throw new DomainError("接單後分裝需設定填充重量");
    const v = await withTx(async (tx) => {
      if (id) {
        const prev = await tx.productVariant.findUniqueOrThrow({ where: { id } });
        if (prev.isBundle !== data.isBundle) {
          const used = await tx.salesOrderItem.count({ where: { variantId: id } });
          if (used) throw new DomainError("已有訂單使用此 SKU，不可切換套組／單品類型");
        }
      }
      const v = id ? await tx.productVariant.update({ where: { id }, data }) : await tx.productVariant.create({ data: { ...data, productId } });
      await tx.variantMaterial.deleteMany({ where: { variantId: v.id } });
      await tx.productBundleComponent.deleteMany({ where: { bundleVariantId: v.id } });
      if (!data.isBundle && materials.length) await tx.variantMaterial.createMany({ data: materials.map((m) => ({ variantId: v.id, ...m })) });
      if (data.isBundle) {
        for (const c of components) {
          if (c.componentVariantId === v.id) throw new DomainError("套組不可包含自己");
          const cv = await tx.productVariant.findUniqueOrThrow({ where: { id: c.componentVariantId } });
          if (cv.isBundle) throw new DomainError("套組組件不可為另一個套組");
          if (!/^\d+$/.test(String(c.quantity))) throw new DomainError("組件數量需為整數");
        }
        await tx.productBundleComponent.createMany({ data: components.map((c) => ({ bundleVariantId: v.id, componentVariantId: c.componentVariantId, quantity: Number(c.quantity) })) });
      } else if (data.stockPolicy !== "NOT_TRACKED") {
        await ensureVariantItem(tx, v.id);
      }
      await audit(tx, actor, id ? "variant.update" : "variant.create", "ProductVariant", v.id, `${v.sku} 售價 ${v.salePrice}`);
      return v;
    });
    return { id: v.id, redirect: `/products/${productId}` };
  },
  { revalidate: ["/products"] },
);
