/**
 * 批次追溯：訂單 → SKU → 包裝批次 → 烘焙批次 → 生豆採購批次。
 * 內部追溯不含顧客個資（僅訂單編號）；公開 QR 履歷只輸出可公開欄位。
 */
import { prisma } from "@/lib/db";
import { D } from "@/lib/decimal";
import { NotFoundError } from "@/lib/errors";
import { freshnessOf } from "./roasting";

export async function traceOrder(orderId: string, db = prisma) {
  const order = await db.salesOrder.findUnique({
    where: { id: orderId },
    select: {
      orderNo: true,
      fulfillmentStatus: true,
      items: {
        select: {
          skuSnapshot: true,
          nameSnapshot: true,
          quantity: true,
          costSnapshot: true,
          allocations: {
            where: { status: { not: "RELEASED" } },
            select: {
              quantity: true,
              unitCost: true,
              status: true,
              variant: { select: { sku: true } },
              lot: {
                select: {
                  lotCode: true,
                  unitCost: true,
                  packagingBatch: {
                    select: {
                      batchNo: true,
                      packagedAt: true,
                      quantity: true,
                      unitCost: true,
                      productionOrder: {
                        select: {
                          orderNo: true,
                          fillWeightG: true,
                          beansConsumedG: true,
                          lossG: true,
                          consumptions: { select: { kind: true, quantity: true, unitCost: true, totalCost: true, lot: { select: { lotCode: true } } } },
                          sourceLot: {
                            select: {
                              lotCode: true,
                              unitCost: true,
                              roastBatch: {
                                select: {
                                  batchNo: true,
                                  roastedAt: true,
                                  greenWeightG: true,
                                  roastedWeightG: true,
                                  weightLossPercent: true,
                                  greenCostTotal: true,
                                  greenLot: {
                                    select: {
                                      lotCode: true,
                                      costPerG: true,
                                      receivedAt: true,
                                      purchase: { select: { purchaseNo: true, purchaseDate: true } },
                                      coffee: { select: { nameZh: true, country: true, region: true, process: true } },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!order) throw new NotFoundError("訂單");
  // 檢查數量一致性
  const checks = order.items.map((it) => {
    const allocated = it.allocations.reduce((s, a) => s.add(a.quantity), D(0));
    return { sku: it.skuSnapshot, ordered: it.quantity, allocated: allocated.toString() };
  });
  return { order, checks };
}

/** 公開履歷（QR Code）：不含成本、私人研發備註、顧客資料 */
export async function publicTrace(publicCode: string, db = prisma) {
  const t = await db.productTraceability.findUnique({
    where: { publicCode },
    include: {
      packagingBatch: {
        include: {
          productionOrder: {
            include: {
              targetVariant: { include: { product: { include: { brandSeries: { include: { recommendedRecipe: true } } } } } },
              sourceLot: { include: { roastBatch: { include: { greenLot: { include: { coffee: true } } } } } },
            },
          },
        },
      },
    },
  });
  if (!t || !t.isPublished) return null;
  const po = t.packagingBatch.productionOrder;
  const rb = po.sourceLot.roastBatch;
  const coffee = rb?.greenLot.coffee;
  const product = po.targetVariant.product;
  const recipe = product.brandSeries?.recommendedRecipe;
  return {
    productName: product.name,
    variantName: po.targetVariant.name,
    series: product.brandSeries ? { code: product.brandSeries.code, name: product.brandSeries.name, story: product.brandSeries.story } : null,
    batchNo: t.packagingBatch.batchNo,
    packagedAt: t.packagingBatch.packagedAt,
    expiryDate: t.packagingBatch.expiryDate,
    roastBatchNo: rb?.batchNo ?? null,
    roastedAt: rb?.roastedAt ?? null,
    roastLevel: rb?.roastLevel ?? null,
    coffee: coffee
      ? { name: coffee.nameZh, nameEn: coffee.nameEn, country: coffee.country, region: coffee.region, farm: coffee.farm, variety: coffee.variety, process: coffee.process, altitude: coffee.altitude }
      : null,
    flavorNotes: product.flavorNotes ?? coffee?.originFlavorNotes ?? null,
    freshness: rb && coffee ? freshnessOf(rb, coffee) : null,
    recommendedBrew: t.recommendedBrew ?? (recipe ? `${recipe.doseG}g 粉 / ${recipe.waterG}g 水${recipe.waterTempC ? ` / ${recipe.waterTempC}°C` : ""}${recipe.pourMethod ? `／${recipe.pourMethod}` : ""}` : null),
  };
}
