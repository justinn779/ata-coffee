/**
 * 追溯：訂單 → SKU → 包裝批次 → 烘焙批次 → 生豆批次。內部追溯不含顧客個資；公開履歷只寫入可公開欄位。
 */
import type { Firestore } from "firebase-admin/firestore";
import { D } from "../../../src/lib/decimal";
import { DomainError } from "../../../src/lib/errors";
import { nowIso, type Tx } from "../tx";
import { C, type Actor } from "../types";
import { audit } from "./core";
import { freshnessOf } from "./roasting";

const get = async (db: Firestore, col: string, id?: string | null) => {
  if (!id) return null;
  const s = await db.collection(col).doc(id).get();
  return s.exists ? ({ ...(s.data() as object), id: s.id } as Record<string, unknown> & { id: string }) : null;
};

export async function traceOrder(db: Firestore, orderId: string) {
  const order = await get(db, C.orders, orderId);
  if (!order) throw new DomainError("找不到訂單", "NOT_FOUND", 404);
  const items = (await db.collection(C.orderItems).where("orderId", "==", orderId).get()).docs.map((d) => ({ ...(d.data() as object), id: d.id }) as Record<string, unknown> & { id: string });
  const allocs = (await db.collection(C.allocations).where("orderId", "==", orderId).get()).docs.map((d) => ({ ...(d.data() as object), id: d.id }) as Record<string, unknown> & { id: string }).filter((a) => a.status !== "RELEASED");
  const chains = [];
  for (const a of allocs) {
    const lot = await get(db, C.lots, a.lotId as string);
    const pkg = await get(db, C.packagingBatches, lot?.packagingBatchId as string);
    const po = await get(db, C.productionOrders, pkg?.productionOrderId as string);
    const rb = await get(db, C.roastBatches, (po?.roastBatchId as string) ?? null);
    const gl = await get(db, C.greenLots, rb?.greenLotId as string);
    chains.push({
      sku: a.sku,
      quantity: a.quantity,
      unitCost: a.unitCost,
      status: a.status,
      lotCode: lot?.lotCode ?? null,
      packaging: pkg ? { batchNo: pkg.batchNo, packagedAt: pkg.packagedAt, unitCost: pkg.unitCost } : null,
      production: po ? { orderNo: po.orderNo, fillWeightG: po.fillWeightG, beansConsumedG: po.beansConsumedG, lossG: po.lossG } : null,
      roast: rb ? { id: rb.id, batchNo: rb.batchNo, roastedAt: rb.roastedAt, weightLossPercent: rb.weightLossPercent } : null,
      green: gl ? { lotCode: gl.lotCode, coffeeName: gl.coffeeName, purchaseNo: gl.purchaseNo, purchaseDate: gl.purchaseDate, costPerG: gl.costPerG } : null,
    });
  }
  const checks = items.map((it) => ({ sku: it.skuSnapshot as string, ordered: it.quantity as number, allocated: allocs.filter((a) => a.orderItemId === it.id).reduce((s, a) => s.add(a.quantity as string), D(0)).toString(), isBundle: !!it.isBundle }));
  return { orderNo: order.orderNo as string, chains, checks };
}

/** 發布／取消發布 QR 履歷；發布時把可公開欄位寫入 publicTraces（任何人可讀） */
export async function setTracePublished(tx: Tx, traceId: string, publish: boolean, recommendedBrew: string | null | undefined, actor: Actor) {
  const t = await tx.must(C.traces, traceId, "履歷");
  if (!publish) {
    await tx.update(C.traces, t.id, { isPublished: false });
    tx.set(C.publicTraces, t.publicCode as string, { published: false, updatedAt: nowIso() });
    audit(tx, actor, "trace.unpublish", "Trace", t.id, "取消發布 QR 履歷");
    return;
  }
  const pkg = await tx.must(C.packagingBatches, t.packagingBatchId as string, "包裝批次");
  const po = await tx.must(C.productionOrders, pkg.productionOrderId as string, "生產單");
  const variant = await tx.must(C.variants, po.targetVariantId as string, "品項");
  const product = await tx.must(C.products, variant.productId as string, "商品");
  const series = product.brandSeriesId ? await tx.get(C.series, product.brandSeriesId as string) : null;
  const recipe = series?.recommendedRecipeId ? await tx.get(C.brewRecipes, series.recommendedRecipeId as string) : null;
  const rb = po.roastBatchId ? await tx.get(C.roastBatches, po.roastBatchId as string) : null;
  const coffee = rb ? await tx.get(C.coffees, rb.coffeeId as string) : null;
  const brew = recommendedBrew ?? (t.recommendedBrew as string | null) ?? (recipe ? `${recipe.doseG}g 粉 / ${recipe.waterG}g 水${recipe.waterTempC ? ` / ${recipe.waterTempC}°C` : ""}${recipe.pourMethod ? `／${recipe.pourMethod}` : ""}` : null);
  const fresh = rb && coffee ? freshnessOf(rb as never, coffee as never) : null;
  tx.set(C.publicTraces, t.publicCode as string, {
    published: true,
    productName: product.name,
    variantName: variant.name,
    series: series ? { code: series.code, name: series.name, story: series.story ?? null } : null,
    batchNo: pkg.batchNo,
    packagedAt: pkg.packagedAt,
    expiryDate: pkg.expiryDate ?? null,
    roastBatchNo: rb?.batchNo ?? null,
    roastedAt: rb?.roastedAt ?? null,
    roastLevel: rb?.roastLevel ?? null,
    coffee: coffee ? { name: coffee.nameZh, nameEn: coffee.nameEn ?? null, country: coffee.country ?? null, region: coffee.region ?? null, farm: coffee.farm ?? null, variety: coffee.variety ?? null, process: coffee.process ?? null, altitude: coffee.altitude ?? null } : null,
    flavorNotes: product.flavorNotes ?? coffee?.originFlavorNotes ?? null,
    peakFrom: fresh?.peakFrom?.value ?? null,
    peakTo: fresh?.peakTo?.value ?? null,
    recommendedBrew: brew,
    updatedAt: nowIso(),
  });
  await tx.update(C.traces, t.id, { isPublished: true, recommendedBrew: recommendedBrew ?? t.recommendedBrew ?? null });
  audit(tx, actor, "trace.publish", "Trace", t.id, `發布 QR 履歷 ${pkg.batchNo}`);
}
