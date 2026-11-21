import { prisma, withTx } from "@/lib/db";
import { D } from "@/lib/decimal";
import type { Actor } from "@/server/domain/audit";
import { receiveGreenPurchase } from "@/server/domain/green";
import { createRoastBatch } from "@/server/domain/roasting";
import { completeProductionOrder, createProductionOrder } from "@/server/domain/production";
import { ensureMaterialItem, createLot, post } from "@/server/domain/inventory";

export const actor: Actor = { userId: null };

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // TRUNCATE 不觸發列層級 trigger，僅供測試重置
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export async function lotOf(id: string) {
  return prisma.inventoryLot.findUniqueOrThrow({ where: { id } });
}

export const n = (v: unknown) => D(v as string).toNumber();

/** 建立基本主檔：咖啡豆、烘豆機、包材、商品 SKU */
export async function baseFixture(opts?: { variantPolicy?: "STOCK_ONLY" | "MADE_TO_ORDER" }) {
  const coffee = await prisma.coffee.create({ data: { code: "ETH-YRG", nameZh: "耶加雪菲 水洗", country: "衣索比亞", shelfLifeDays: 180 } });
  const roaster = await prisma.roasterProfile.create({ data: { name: "Olomo 測試機", brand: "Olomo", model: "TEST", maxCapacityG: 1200, tempChannels: ["BT", "ET"] } });
  const bag = await prisma.material.create({ data: { code: "BAG-100", name: "100g 夾鏈袋", category: "BAG" } });
  const label = await prisma.material.create({ data: { code: "LBL-01", name: "標籤", category: "LABEL" } });
  const product = await prisma.product.create({ data: { code: "P-YRG", name: "ATA 001 耶加雪菲", category: "COFFEE_BEAN", coffeeId: coffee.id, status: "ACTIVE" } });
  const v100 = await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku: "YRG-100",
      name: "100g",
      listPrice: 450,
      salePrice: 420,
      fillWeightG: 100,
      stockPolicy: opts?.variantPolicy ?? "STOCK_ONLY",
      materials: { create: [{ materialId: bag.id, quantityPerUnit: 1 }, { materialId: label.id, quantityPerUnit: 1 }] },
    },
  });
  const v200 = await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku: "YRG-200",
      name: "200g",
      listPrice: 800,
      salePrice: 780,
      fillWeightG: 200,
      stockPolicy: "MADE_TO_ORDER",
      materials: { create: [{ materialId: bag.id, quantityPerUnit: 1 }, { materialId: label.id, quantityPerUnit: 1 }] },
    },
  });
  // 包材入庫：袋 50 個 @ NT$5、標籤 50 張 @ NT$1
  await withTx(async (tx) => {
    for (const [m, cost] of [[bag, 5], [label, 1]] as const) {
      const item = await ensureMaterialItem(tx, m.id);
      const lot = await createLot(tx, { itemId: item.id, lotCode: `${m.code}-L1`, unitCost: cost });
      await post(tx, { lotId: lot.id, type: "RECEIPT", quantity: 50, actor });
    }
  });
  return { coffee, roaster, bag, label, product, v100, v200 };
}

export async function receiveGreen(coffeeId: string, grams = 5000, pricePerKg = 600) {
  return withTx((tx) =>
    receiveGreenPurchase(
      tx,
      { coffeeId, purchaseDate: new Date("2026-11-01T00:00:00Z"), receivedAt: new Date(), purchasedWeightG: grams, receivedWeightG: grams, unitPricePerKg: pricePerKg },
      actor,
    ),
  );
}

export async function roast(greenLotId: string, roasterId: string, green = 500, roasted = 425) {
  return withTx((tx) => createRoastBatch(tx, { greenLotId, roasterId, roastedAt: new Date(), greenWeightG: green, roastedWeightG: roasted, dryEndSec: 240, firstCrackStartSec: 480, dropSec: 600 }, actor));
}

export async function packageUnits(sourceLotId: string, variantId: string, qty: number, lossG = 0) {
  return withTx(async (tx) => {
    const po = await createProductionOrder(tx, { sourceLotId, targetVariantId: variantId, plannedQty: qty, plannedDate: new Date("2026-11-21T00:00:00Z") }, actor);
    return completeProductionOrder(tx, po.id, { actualQty: qty, lossG }, actor);
  });
}
