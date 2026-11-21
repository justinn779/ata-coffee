/**
 * 管理會計報表（非稅務申報系統）。營收於出貨時認列，採訂單快照。
 *  商品銷售淨額 = Σ 明細小計（含稅價時扣除內含稅額）
 *  COGS = Σ 已出貨分配 數量 × 批次單位成本 − 當月退貨重新入庫成本
 *  銷貨毛利 = 商品淨額 − 退款 − COGS
 *  訂單貢獻利益 = 銷貨毛利 + 運費收入 − 訂單直接成本
 *  營業淨利（管理用）= 訂單貢獻利益 − 期間營運費用
 */
import type { Firestore } from "firebase-admin/firestore";
import { D, Decimal } from "../../../src/lib/decimal";
import { monthRangeTaipei } from "../../../src/lib/time";
import { C } from "../types";

type R = Record<string, unknown> & { id: string };
async function q(db: Firestore, col: string, field: string, from: string, to: string): Promise<R[]> {
  const s = await db.collection(col).where(field, ">=", from).where(field, "<", to).get();
  return s.docs.map((d) => ({ ...(d.data() as object), id: d.id }));
}
async function byIn(db: Firestore, col: string, field: string, ids: string[]): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += 30) {
    const s = await db.collection(col).where(field, "in", ids.slice(i, i + 30)).get();
    out.push(...s.docs.map((d) => ({ ...(d.data() as object), id: d.id })));
  }
  return out;
}

const s = (v: Decimal) => v.toDecimalPlaces(2).toString();

export async function monthlyReport(db: Firestore, month: string) {
  const { start, end } = monthRangeTaipei(month);
  const orders = await q(db, C.orders, "shippedAt", start.toISOString(), end.toISOString());
  const ids = orders.map((o) => o.id);
  const [items, allocs] = ids.length ? await Promise.all([byIn(db, C.orderItems, "orderId", ids), byIn(db, C.allocations, "orderId", ids)]) : [[], []];
  const taxMode = new Map(orders.map((o) => [o.id, o.taxMode as string]));
  let netSales = D(0), tax = D(0), discounts = D(0), shippingIncome = D(0), cogs = D(0);
  for (const it of items) {
    const line = D(it.lineTotal as string);
    netSales = netSales.add(taxMode.get(it.orderId as string) === "INCLUSIVE" ? line.sub(it.taxAmount as string) : line);
    tax = tax.add(it.taxAmount as string);
    discounts = discounts.add(it.discount as string);
  }
  for (const a of allocs) if (a.status === "SHIPPED") cogs = cogs.add(D(a.quantity as string).mul(a.unitCost as string));
  for (const o of orders) shippingIncome = shippingIncome.add(o.shippingFee as string);
  const payments = await q(db, C.payments, "occurredAt", start.toISOString(), end.toISOString());
  const refunds = payments.filter((p) => p.type === "REFUND").reduce((t, p) => t.add(p.amount as string), D(0));
  const rets = await db.collection(C.returns).get();
  let returnedCost = D(0);
  for (const r of rets.docs) for (const it of (r.data().items as Array<Record<string, string>>) ?? []) if (it.disposition === "RESTOCK" && it.inspectedAt >= start.toISOString() && it.inspectedAt < end.toISOString()) returnedCost = returnedCost.add(D(it.quantity).mul(it.unitCost));
  const [y, m] = month.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const costs = await q(db, C.costs, "occurredOn", `${month}-01`, `${nextMonth}-01`);
  const orderDirectCosts = costs.filter((c) => c.target === "SALES_ORDER").reduce((t, c) => t.add(c.amount as string), D(0));
  const operatingExpenses = costs.filter((c) => c.target === "PERIOD").reduce((t, c) => t.add(c.amount as string), D(0));
  const estimatedCostShare = costs.filter((c) => c.isEstimate).reduce((t, c) => t.add(c.amount as string), D(0));
  const netCogs = cogs.sub(returnedCost);
  const grossProfit = netSales.sub(refunds).sub(netCogs);
  const contribution = grossProfit.add(shippingIncome).sub(orderDirectCosts);
  const base = netSales.sub(refunds);
  return {
    month,
    orderCount: orders.length,
    netSales: s(netSales),
    taxCollected: s(tax),
    discounts: s(discounts),
    shippingIncome: s(shippingIncome),
    refunds: s(refunds),
    cogs: s(netCogs),
    returnedCost: s(returnedCost),
    grossProfit: s(grossProfit),
    grossMarginPct: base.gt(0) ? grossProfit.div(base).mul(100).toDecimalPlaces(1).toString() : null,
    orderDirectCosts: s(orderDirectCosts),
    contribution: s(contribution),
    operatingExpenses: s(operatingExpenses),
    netOperatingProfit: s(contribution.sub(operatingExpenses)),
    estimatedCostShare: s(estimatedCostShare),
  };
}
export type MonthlyReport = Awaited<ReturnType<typeof monthlyReport>>;

export async function skuPerformance(db: Firestore, month: string) {
  const { start, end } = monthRangeTaipei(month);
  const orders = await q(db, C.orders, "shippedAt", start.toISOString(), end.toISOString());
  const ids = orders.map((o) => o.id);
  if (!ids.length) return [];
  const [items, allocs] = await Promise.all([byIn(db, C.orderItems, "orderId", ids), byIn(db, C.allocations, "orderId", ids)]);
  const taxMode = new Map(orders.map((o) => [o.id, o.taxMode as string]));
  const map = new Map<string, { sku: string; name: string; qty: number; revenue: Decimal; cogs: Decimal }>();
  for (const it of items) {
    const row = map.get(it.skuSnapshot as string) ?? { sku: it.skuSnapshot as string, name: it.nameSnapshot as string, qty: 0, revenue: D(0), cogs: D(0) };
    row.qty += it.quantity as number;
    row.revenue = row.revenue.add(taxMode.get(it.orderId as string) === "INCLUSIVE" ? D(it.lineTotal as string).sub(it.taxAmount as string) : (it.lineTotal as string));
    row.cogs = row.cogs.add(allocs.filter((a) => a.orderItemId === it.id && a.status === "SHIPPED").reduce((t, a) => t.add(D(a.quantity as string).mul(a.unitCost as string)), D(0)));
    map.set(row.sku, row);
  }
  return [...map.values()]
    .sort((a, b) => b.revenue.cmp(a.revenue))
    .map((r) => ({ sku: r.sku, name: r.name, qty: r.qty, revenue: s(r.revenue), cogs: s(r.cogs), margin: s(r.revenue.sub(r.cogs)), marginPct: r.revenue.gt(0) ? r.revenue.sub(r.cogs).div(r.revenue).mul(100).toDecimalPlaces(1).toString() : null }));
}

export async function lossStats(db: Firestore, month: string) {
  const { start, end } = monthRangeTaipei(month);
  const roasts = await q(db, C.roastBatches, "roastedAt", start.toISOString(), end.toISOString());
  const green = roasts.reduce((t, r) => t.add(r.greenWeightG as string), D(0));
  const roasted = roasts.reduce((t, r) => t.add(r.roastedWeightG as string), D(0));
  const txs = (await q(db, C.txs, "occurredAt", start.toISOString(), end.toISOString())).filter((t) => t.unit === "G");
  const sum = (type: string) => txs.filter((t) => t.type === type).reduce((a, t) => a.add(t.quantity as string), D(0)).abs().toString();
  return {
    roastCount: roasts.length,
    greenIn: green.toString(),
    roastedOut: roasted.toString(),
    avgWeightLossPct: green.gt(0) ? green.sub(roasted).div(green).mul(100).toDecimalPlaces(2).toString() : null,
    packagingLossG: sum("PACKAGING_LOSS"),
    scrapG: sum("SCRAP"),
    cuppingG: sum("CUPPING_USE"),
    tastingG: sum("TASTING_USE"),
    sampleG: sum("SAMPLE_GIFT"),
  };
}
