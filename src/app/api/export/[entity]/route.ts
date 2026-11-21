import { prisma } from "@/lib/db";
import { fmtDateTime, fmtDbDate } from "@/lib/time";
import { getCurrentUser } from "@/server/auth";
import { monthlyReport } from "@/server/domain/reports";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => {
  if (v == null) return "";
  let s = v instanceof Date ? fmtDateTime(v) : String(v);
  // 防止 CSV 公式注入
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const csv = (rows: Record<string, unknown>[], headers?: string[]) => {
  const h = headers ?? Object.keys(rows[0] ?? {});
  return "﻿" + [h.join(","), ...rows.map((r) => h.map((k) => esc(r[k])).join(","))].join("\r\n");
};

const EXPORTS: Record<string, (url: URL) => Promise<Record<string, unknown>[]>> = {
  coffees: async () => (await prisma.coffee.findMany({ orderBy: { code: "asc" } })).map(({ id: _id, supplierId: _s, imageKey: _i, ...c }) => c),
  "green-lots": async () =>
    (await prisma.greenBeanLot.findMany({ include: { coffee: true, purchase: true, inventoryLot: true }, orderBy: { receivedAt: "asc" } })).map((g) => ({
      lotCode: g.lotCode, purchaseNo: g.purchase.purchaseNo, purchaseDate: fmtDbDate(g.purchase.purchaseDate), coffee: g.coffee.nameZh, purchasedWeightG: g.purchasedWeightG, receivedWeightG: g.receivedWeightG, unitPricePerKg: g.unitPricePerKg, shippingCost: g.shippingCost, otherCost: g.otherCost, costPerG: g.costPerG, moisturePercent: g.moisturePercent, densityGPerL: g.densityGPerL, remainingG: g.inventoryLot?.onHand, receivedAt: g.receivedAt,
    })),
  "roast-batches": async () =>
    (await prisma.roastBatch.findMany({ include: { greenLot: { include: { coffee: true } }, roaster: true, inventoryLot: true }, orderBy: { roastedAt: "asc" } })).map((r) => ({
      batchNo: r.batchNo, roastedAt: r.roastedAt, coffee: r.greenLot.coffee.nameZh, greenLot: r.greenLot.lotCode, roaster: r.roaster.name, greenWeightG: r.greenWeightG, roastedWeightG: r.roastedWeightG, weightLossPercent: r.weightLossPercent, chargeTempC: r.chargeTempC, dryEndSec: r.dryEndSec, firstCrackStartSec: r.firstCrackStartSec, dropSec: r.dropSec, dropTempC: r.dropTempC, dtrPercent: r.dtrPercent, roastLevel: r.roastLevel, greenCostTotal: r.greenCostTotal, roastedCostPerG: r.inventoryLot?.unitCost, note: r.note,
    })),
  cupping: async () =>
    (await prisma.cuppingSession.findMany({ include: { roastBatch: { include: { greenLot: { include: { coffee: true } } } }, scores: true, template: true }, orderBy: { cuppedAt: "asc" } })).map((c) => ({
      cuppedAt: c.cuppedAt, roastBatch: c.roastBatch.batchNo, coffee: c.roastBatch.greenLot.coffee.nameZh, restDays: c.restDays, template: c.template.name, totalScore: c.totalScore, ...Object.fromEntries(c.scores.map((s) => [s.label, s.score])), description: c.description,
    })),
  brews: async () =>
    (await prisma.brewSession.findMany({ include: { roastBatch: { include: { greenLot: { include: { coffee: true } } } } }, orderBy: { brewedAt: "asc" } })).map((b) => ({
      brewedAt: b.brewedAt, roastBatch: b.roastBatch.batchNo, coffee: b.roastBatch.greenLot.coffee.nameZh, restDays: b.restDays, doseG: b.doseG, waterG: b.waterG, ratio: b.ratio, waterTempC: b.waterTempC, totalTimeSec: b.totalTimeSec, tdsPercent: b.tdsPercent, extractionPercent: b.extractionPercent, rating: b.rating, flavorNotes: b.flavorNotes,
    })),
  "inventory-ledger": async () =>
    (await prisma.inventoryTransaction.findMany({ include: { item: true, lot: true, actor: true }, orderBy: { occurredAt: "asc" } })).map((t) => ({
      transactionId: t.id, groupId: t.groupId, occurredAt: t.occurredAt, kind: t.item.kind, item: t.item.name, lot: t.lot.lotCode, type: t.type, quantity: t.quantity, unit: t.unit, unitCost: t.unitCost, balanceAfter: t.balanceAfter, refType: t.refType, refId: t.refId, reversesId: t.reversesId, actor: t.actor?.email, note: t.note,
    })),
  "inventory-lots": async () =>
    (await prisma.inventoryLot.findMany({ include: { item: true }, orderBy: { createdAt: "asc" } })).map((l) => ({ lotCode: l.lotCode, kind: l.item.kind, item: l.item.name, status: l.status, onHand: l.onHand, reserved: l.reserved, unitCost: l.unitCost, expiryDate: fmtDbDate(l.expiryDate) })),
  orders: async () =>
    (await prisma.salesOrder.findMany({ include: { shipment: true }, orderBy: { orderedAt: "asc" } })).map((o) => ({
      orderNo: o.orderNo, orderedAt: o.orderedAt, channel: o.channel, customerName: o.customerName, paymentStatus: o.paymentStatus, fulfillmentStatus: o.fulfillmentStatus, taxMode: o.taxMode, subtotal: o.subtotal, discountTotal: o.discountTotal, taxTotal: o.taxTotal, shippingFee: o.shippingFee, total: o.total, refundedTotal: o.refundedTotal, shippedAt: o.shipment?.shippedAt, trackingNo: o.shipment?.trackingNo,
    })),
  "order-items": async () =>
    (await prisma.salesOrderItem.findMany({ include: { order: true }, orderBy: { order: { orderedAt: "asc" } } })).map((i) => ({ orderNo: i.order.orderNo, sku: i.skuSnapshot, name: i.nameSnapshot, quantity: i.quantity, unitPrice: i.unitPriceSnapshot, discount: i.discount, taxAmount: i.taxAmount, lineTotal: i.lineTotal, costSnapshot: i.costSnapshot })),
  products: async () =>
    (await prisma.productVariant.findMany({ include: { product: true }, orderBy: { sku: "asc" } })).map((v) => ({ sku: v.sku, product: v.product.name, variant: v.name, category: v.product.category, listPrice: v.listPrice, salePrice: v.salePrice, standardCost: v.standardCost, fillWeightG: v.fillWeightG, isBundle: v.isBundle, stockPolicy: v.stockPolicy, status: v.status })),
  customers: async () => (await prisma.customer.findMany({ orderBy: { code: "asc" } })).map(({ id: _id, ...c }) => c),
  "monthly-report": async (url) => {
    const m = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(m)) return [];
    const r = await monthlyReport(m);
    return Object.entries(r).map(([k, v]) => ({ 項目: k, 數值: v?.toString() ?? "" }));
  },
};

export async function GET(req: Request, { params }: { params: Promise<{ entity: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("未登入", { status: 401 });
  const { entity } = await params;
  const fn = EXPORTS[entity];
  if (!fn) return new Response("不支援的匯出類型", { status: 404 });
  const rows = await fn(new URL(req.url));
  await prisma.auditLog.create({ data: { actorId: user.id, action: "data.export", entityType: "Export", entityId: entity, summary: `匯出 ${entity}（${rows.length} 筆）` } });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return new Response(csv(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ata-${entity}-${stamp}.csv"`, "Cache-Control": "no-store" },
  });
}
