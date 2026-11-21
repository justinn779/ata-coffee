import { prisma } from "@/lib/db";
import { verifyApiKey } from "@/server/auth";
import { variantAvailability } from "@/app/(app)/products/availability";

export const dynamic = "force-dynamic";

/** 未來官網商品 API：只輸出可公開欄位（不含成本） */
export async function GET(req: Request) {
  const key = await verifyApiKey(req.headers.get("authorization"), "products:read");
  if (!key) return Response.json({ error: "未授權" }, { status: 401 });
  const [variants, avail] = await Promise.all([
    prisma.productVariant.findMany({ where: { status: "ACTIVE", product: { status: "ACTIVE" } }, include: { product: { include: { brandSeries: true } } } }),
    variantAvailability(),
  ]);
  return Response.json(
    variants.map((v) => ({
      sku: v.sku,
      name: `${v.product.name}｜${v.name}`,
      category: v.product.category,
      series: v.product.brandSeries?.code ?? null,
      listPrice: v.listPrice.toString(),
      salePrice: v.salePrice.toString(),
      flavorNotes: v.product.flavorNotes,
      description: v.product.description,
      isLimited: v.product.isLimited,
      available: v.stockPolicy === "NOT_TRACKED" ? null : Number(avail.get(v.id) ?? 0),
      madeToOrder: v.stockPolicy === "MADE_TO_ORDER",
    })),
  );
}
