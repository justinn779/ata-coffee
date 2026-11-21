import { z } from "zod";
import { prisma, withTx } from "@/lib/db";
import { DomainError, errorMessage } from "@/lib/errors";
import { rateLimit, verifyApiKey } from "@/server/auth";
import { createOrder } from "@/server/domain/orders";

export const dynamic = "force-dynamic";

/**
 * 未來官網訂單 API（伺服器對伺服器）。
 *  Authorization: Bearer <API 金鑰>（scope: orders:create）
 *  Idempotency-Key: <官網訂單唯一識別>（必填，重送不會重複建立）
 * 只接受 SKU 與數量；價格、成本、庫存由本系統決定。前台不可直接修改庫存。
 */
const body = z.object({
  externalRef: z.string().min(1).max(100),
  customer: z.object({ name: z.string().min(1).max(100), phone: z.string().max(50).optional(), email: z.string().email().max(200).optional(), address: z.string().max(500).optional() }),
  shippingMethod: z.string().max(100).optional(),
  shippingFee: z.number().min(0).max(100000).optional(),
  note: z.string().max(1000).optional(),
  items: z.array(z.object({ sku: z.string().min(1).max(60), quantity: z.number().int().min(1).max(999) })).min(1).max(50),
});

export async function POST(req: Request) {
  const key = await verifyApiKey(req.headers.get("authorization"), "orders:create");
  if (!key) return Response.json({ error: "未授權" }, { status: 401 });
  if (!(await rateLimit(`api:${key.id}`, 60, 60))) return Response.json({ error: "請求過於頻繁" }, { status: 429 });
  const idem = req.headers.get("idempotency-key");
  if (!idem || idem.length > 100) return Response.json({ error: "缺少 Idempotency-Key" }, { status: 400 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "格式錯誤", issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;
  try {
    const variants = await prisma.productVariant.findMany({ where: { sku: { in: b.items.map((i) => i.sku) }, status: "ACTIVE", product: { status: "ACTIVE" } } });
    const bySku = new Map(variants.map((v) => [v.sku, v]));
    const missing = b.items.filter((i) => !bySku.has(i.sku)).map((i) => i.sku);
    if (missing.length) throw new DomainError(`商品不存在或未上架：${missing.join(", ")}`);
    const { order, duplicate } = await withTx((tx) =>
      createOrder(
        tx,
        {
          channel: "WEB",
          externalRef: b.externalRef,
          idempotencyKey: `web:${idem}`,
          customerName: b.customer.name,
          customerPhone: b.customer.phone,
          customerEmail: b.customer.email,
          shippingAddress: b.customer.address,
          shippingMethod: b.shippingMethod,
          shippingFee: b.shippingFee ?? 0,
          note: b.note,
          items: b.items.map((i) => ({ variantId: bySku.get(i.sku)!.id, quantity: i.quantity })),
        },
        { userId: null, ip: `api:${key.prefix}` },
      ),
    );
    return Response.json({ orderNo: order.orderNo, total: order.total.toString(), paymentStatus: order.paymentStatus, fulfillmentStatus: order.fulfillmentStatus, duplicate }, { status: duplicate ? 200 : 201 });
  } catch (e) {
    const status = e instanceof DomainError ? e.status : 500;
    return Response.json({ error: errorMessage(e) }, { status });
  }
}
