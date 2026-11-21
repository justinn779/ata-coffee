import { prisma } from "@/lib/db";
import { D, Decimal } from "@/lib/decimal";

/** 各 SKU 可售量：單品 = 可用批次 (在庫 − 保留) 加總；套組 = min(組件可售 ÷ 組件數量)，僅供顯示，不另外保留 */
export async function variantAvailability() {
  const rows = await prisma.$queryRaw<Array<{ variantId: string; available: string }>>`
    SELECT i."productVariantId" AS "variantId", COALESCE(SUM(l."onHand" - l.reserved) FILTER (WHERE l.status = 'AVAILABLE'), 0)::text AS available
    FROM "InventoryItem" i LEFT JOIN "InventoryLot" l ON l."itemId" = i.id
    WHERE i."productVariantId" IS NOT NULL GROUP BY i."productVariantId"`;
  const map = new Map<string, Decimal>(rows.map((r) => [r.variantId, D(r.available)]));
  const bundles = await prisma.productBundleComponent.findMany();
  const byBundle = new Map<string, typeof bundles>();
  for (const b of bundles) byBundle.set(b.bundleVariantId, [...(byBundle.get(b.bundleVariantId) ?? []), b]);
  for (const [bid, comps] of byBundle) {
    map.set(bid, Decimal.min(...comps.map((c) => (map.get(c.componentVariantId) ?? D(0)).div(c.quantity).floor())));
  }
  return map;
}
