/**
 * 管理會計報表（非稅務申報系統）。
 *
 * 認列原則：營收於出貨時認列（出貨月份），採訂單快照金額。
 *  商品銷售淨額 = Σ 明細小計（含稅價時扣除內含稅額）
 *  銷貨成本 COGS = Σ 已出貨分配批次之 數量 × 批次單位成本（快照）
 *                  − 退貨重新入庫之成本（檢查完成月份）
 *  銷貨毛利 = 商品銷售淨額 − 退款 − COGS
 *  訂單貢獻利益 = 銷貨毛利 + 運費收入 − 訂單直接成本（物流、平台、金流、其他）
 *  營業淨利（管理用） = 訂單貢獻利益 − 期間營運費用
 */
import { prisma } from "@/lib/db";
import { D, Decimal } from "@/lib/decimal";
import { monthRangeTaipei } from "@/lib/time";

export interface MonthlyReport {
  month: string;
  orderCount: number;
  netSales: Decimal;
  taxCollected: Decimal;
  discounts: Decimal;
  shippingIncome: Decimal;
  refunds: Decimal;
  cogs: Decimal;
  returnedCost: Decimal;
  grossProfit: Decimal;
  grossMarginPct: Decimal | null;
  orderDirectCosts: Decimal;
  contribution: Decimal;
  operatingExpenses: Decimal;
  netOperatingProfit: Decimal;
  estimatedCostShare: Decimal;
}

export async function monthlyReport(month: string, db = prisma): Promise<MonthlyReport> {
  const { start, end } = monthRangeTaipei(month);
  const shipped = await db.salesOrder.findMany({
    where: { shipment: { shippedAt: { gte: start, lt: end } } },
    include: { items: { include: { allocations: { where: { status: "SHIPPED" } } } } },
  });
  let netSales = D(0), tax = D(0), discounts = D(0), shippingIncome = D(0), cogs = D(0);
  for (const o of shipped) {
    for (const it of o.items) {
      const line = D(it.lineTotal);
      netSales = netSales.add(o.taxMode === "INCLUSIVE" ? line.sub(it.taxAmount) : line);
      tax = tax.add(it.taxAmount);
      discounts = discounts.add(it.discount);
      cogs = cogs.add(it.allocations.reduce((s, a) => s.add(D(a.quantity).mul(a.unitCost)), D(0)));
    }
    shippingIncome = shippingIncome.add(o.shippingFee);
  }
  const refundsAgg = await db.paymentRecord.aggregate({ where: { type: "REFUND", occurredAt: { gte: start, lt: end } }, _sum: { amount: true } });
  const refunds = D(refundsAgg._sum.amount ?? 0);
  const restocked = await db.returnItem.findMany({
    where: { disposition: "RESTOCK", inspectedAt: { gte: start, lt: end } },
    include: { allocation: true },
  });
  const returnedCost = restocked.reduce((s, r) => s.add(D(r.quantity).mul(r.allocation.unitCost)), D(0));
  const startDate = new Date(month + "-01T00:00:00Z");
  const endDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 1));
  const costs = await db.costEntry.findMany({ where: { occurredOn: { gte: startDate, lt: endDate }, target: { in: ["SALES_ORDER", "PERIOD"] } } });
  const orderDirectCosts = costs.filter((c) => c.target === "SALES_ORDER").reduce((s, c) => s.add(c.amount), D(0));
  const operatingExpenses = costs.filter((c) => c.target === "PERIOD").reduce((s, c) => s.add(c.amount), D(0));
  const estimatedCostShare = costs.filter((c) => c.isEstimate).reduce((s, c) => s.add(c.amount), D(0));

  const netCogs = cogs.sub(returnedCost);
  const grossProfit = netSales.sub(refunds).sub(netCogs);
  const contribution = grossProfit.add(shippingIncome).sub(orderDirectCosts);
  const revenueBase = netSales.sub(refunds);
  return {
    month,
    orderCount: shipped.length,
    netSales,
    taxCollected: tax,
    discounts,
    shippingIncome,
    refunds,
    cogs: netCogs,
    returnedCost,
    grossProfit,
    grossMarginPct: revenueBase.gt(0) ? grossProfit.div(revenueBase).mul(100).toDecimalPlaces(1) : null,
    orderDirectCosts,
    contribution,
    operatingExpenses,
    netOperatingProfit: contribution.sub(operatingExpenses),
    estimatedCostShare,
  };
}

/** SKU 銷售表現（依出貨期間） */
export async function skuPerformance(from: Date, to: Date, db = prisma) {
  const items = await db.salesOrderItem.findMany({
    where: { order: { shipment: { shippedAt: { gte: from, lt: to } } } },
    include: { order: true, allocations: { where: { status: "SHIPPED" } } },
  });
  const map = new Map<string, { sku: string; name: string; qty: number; revenue: Decimal; cogs: Decimal }>();
  for (const it of items) {
    const row = map.get(it.skuSnapshot) ?? { sku: it.skuSnapshot, name: it.nameSnapshot, qty: 0, revenue: D(0), cogs: D(0) };
    row.qty += it.quantity;
    row.revenue = row.revenue.add(it.order.taxMode === "INCLUSIVE" ? D(it.lineTotal).sub(it.taxAmount) : it.lineTotal);
    row.cogs = row.cogs.add(it.allocations.reduce((s, a) => s.add(D(a.quantity).mul(a.unitCost)), D(0)));
    map.set(it.skuSnapshot, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, margin: r.revenue.sub(r.cogs), marginPct: r.revenue.gt(0) ? r.revenue.sub(r.cogs).div(r.revenue).mul(100).toDecimalPlaces(1) : null }))
    .sort((a, b) => b.revenue.cmp(a.revenue));
}

/** 損耗統計 */
export async function lossStats(from: Date, to: Date, db = prisma) {
  const roasts = await db.roastBatch.findMany({ where: { roastedAt: { gte: from, lt: to }, status: "POSTED" } });
  const green = roasts.reduce((s, r) => s.add(r.greenWeightG), D(0));
  const roasted = roasts.reduce((s, r) => s.add(r.roastedWeightG), D(0));
  const txs = await db.inventoryTransaction.groupBy({
    by: ["type"],
    where: { occurredAt: { gte: from, lt: to }, type: { in: ["PACKAGING_LOSS", "SCRAP", "CUPPING_USE", "TASTING_USE", "SAMPLE_GIFT"] }, item: { unit: "G" } },
    _sum: { quantity: true },
  });
  const byType = Object.fromEntries(txs.map((t) => [t.type, D(t._sum.quantity ?? 0).abs()]));
  return {
    roastCount: roasts.length,
    greenIn: green,
    roastedOut: roasted,
    avgWeightLossPct: green.gt(0) ? green.sub(roasted).div(green).mul(100).toDecimalPlaces(2) : null,
    packagingLossG: byType.PACKAGING_LOSS ?? D(0),
    scrapG: byType.SCRAP ?? D(0),
    cuppingG: byType.CUPPING_USE ?? D(0),
    tastingG: byType.TASTING_USE ?? D(0),
    sampleG: byType.SAMPLE_GIFT ?? D(0),
  };
}

/** 烘焙批次成本明細（可追查來源） */
export async function roastBatchCost(roastBatchId: string, db = prisma) {
  const rb = await db.roastBatch.findUniqueOrThrow({
    where: { id: roastBatchId },
    include: { greenLot: true, costEntries: true, inventoryLot: true },
  });
  const extras = rb.costEntries.reduce((s, c) => s.add(c.amount), D(0));
  const total = D(rb.greenCostTotal).add(extras);
  return {
    greenWeightG: D(rb.greenWeightG),
    greenCostPerG: D(rb.greenLot.costPerG),
    greenCostTotal: D(rb.greenCostTotal),
    extras: rb.costEntries,
    total,
    roastedWeightG: D(rb.roastedWeightG),
    roastedCostPerG: rb.inventoryLot ? D(rb.inventoryLot.unitCost) : total.div(rb.roastedWeightG),
  };
}
