import Link from "next/link";
import { prisma } from "@/lib/db";
import { D, fmtGrams, fmtMoney, fmtNum, fmtPct } from "@/lib/decimal";
import { currentMonthTaipei, fmtDate, fmtDbDate, restDays, addDaysDateOnly } from "@/lib/time";
import { FULFILL, PAYMENT } from "@/lib/labels";
import { itemSummaries } from "@/server/domain/inventory";
import { monthlyReport } from "@/server/domain/reports";
import { getSettings } from "@/server/domain/settings";
import { Card, CardBody, CardHeader, LinkButton, PageHeader, SimpleTable, StatCard, A, Badge } from "@/components/ui";
import { StatusBadge } from "@/components/status";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: m } = await searchParams;
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : currentMonthTaipei();
  const settings = await getSettings();
  const [items, report, warnLots, plannedPOs, unpaid, ready, roasts, cuppings, brews] = await Promise.all([
    prisma.$transaction((tx) => itemSummaries(tx)),
    monthlyReport(month),
    prisma.inventoryLot.findMany({
      where: { onHand: { gt: 0 }, status: "AVAILABLE", expiryDate: { lte: addDaysDateOnly(new Date(), settings.inventory.expiryWarnDays) } },
      include: { item: true },
      orderBy: { expiryDate: "asc" },
      take: 8,
    }),
    prisma.productionOrder.findMany({ where: { status: "PLANNED" }, include: { targetVariant: true, salesOrderItem: { include: { order: true } } }, orderBy: { plannedDate: "asc" } }),
    prisma.salesOrder.findMany({ where: { paymentStatus: { in: ["UNPAID", "PENDING_CONFIRMATION"] }, fulfillmentStatus: { not: "CANCELLED" } }, orderBy: { orderedAt: "asc" } }),
    prisma.salesOrder.findMany({ where: { fulfillmentStatus: "READY_TO_SHIP" }, orderBy: { orderedAt: "asc" } }),
    prisma.roastBatch.findMany({ orderBy: { roastedAt: "desc" }, take: 5, include: { greenLot: { include: { coffee: true } } } }),
    prisma.cuppingSession.findMany({ orderBy: { cuppedAt: "desc" }, take: 5, include: { roastBatch: { include: { greenLot: { include: { coffee: true } } } } } }),
    prisma.brewSession.findMany({ orderBy: { brewedAt: "desc" }, take: 5, include: { roastBatch: { include: { greenLot: { include: { coffee: true } } } } } }),
  ]);

  const sum = (kind: string, f: "onHand" | "available" | "reserved") => items.filter((i) => i.kind === kind).reduce((s, i) => s.add(i[f]), D(0));
  const defaultLow: Record<string, number> = { GREEN: settings.inventory.lowGreenG, ROASTED: settings.inventory.lowRoastedG, FINISHED: settings.inventory.lowFinishedPcs, MATERIAL: 0 };
  const low = items.filter((i) => {
    const th = i.lowStockThreshold != null ? D(i.lowStockThreshold) : D(defaultLow[i.kind] ?? 0);
    return th.gt(0) && D(i.available).lt(th);
  });

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`今日概況與 ${month} 經營數字（Asia/Taipei）`}
        actions={
          <form className="flex items-center gap-2" action="/">
            <label htmlFor="month" className="text-xs text-muted">
              報表月份
            </label>
            <input id="month" type="month" name="month" defaultValue={month} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" />
            <button className="h-9 rounded-lg border border-border-strong px-3 text-sm hover:bg-surface-2">套用</button>
          </form>
        }
      />

      <section aria-label="快速新增" className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {[
          ["/green/new", "＋ 生豆採購"],
          ["/roasting/new", "＋ 開始烘焙"],
          ["/cupping/new", "＋ 杯測"],
          ["/brewing/new", "＋ 手沖紀錄"],
          ["/production/new", "＋ 分裝單"],
          ["/orders/new", "＋ 手動訂單"],
          ["/inventory", "查看庫存"],
        ].map(([href, label]) => (
          <LinkButton key={href} href={href} variant={href === "/orders/new" ? "primary" : "outline"} size="sm">
            {label}
          </LinkButton>
        ))}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="生豆總庫存" value={fmtGrams(sum("GREEN", "onHand"))} hint={`可用 ${fmtGrams(sum("GREEN", "available"))}`} href="/inventory?kind=GREEN" />
        <StatCard label="熟豆總庫存" value={fmtGrams(sum("ROASTED", "onHand"))} hint={`已預留分裝 ${fmtGrams(sum("ROASTED", "reserved"))}`} href="/inventory?kind=ROASTED" />
        <StatCard label="成品庫存" value={`${fmtNum(sum("FINISHED", "onHand"), 0)} 件`} hint={`可售 ${fmtNum(sum("FINISHED", "available"), 0)} 件`} href="/inventory?kind=FINISHED" />
        <StatCard label="低庫存提醒" value={`${low.length} 項`} tone={low.length ? "warning" : "sage"} hint={low.slice(0, 2).map((l) => l.name.split("｜").pop()).join("、") || "庫存充足"} href="/inventory?low=1" />
        <StatCard label="未付款／待確認訂單" value={`${unpaid.length} 筆`} tone={unpaid.length ? "danger" : "sage"} href="/orders?pay=open" />
        <StatCard label="待出貨訂單" value={`${ready.length} 筆`} tone={ready.length ? "info" : "sage"} href="/orders?ful=READY_TO_SHIP" />
        <StatCard label={`${month} 營收（商品淨額）`} value={fmtMoney(report.netSales)} hint={`${report.orderCount} 筆出貨訂單`} href={`/reports?month=${month}`} />
        <StatCard label={`${month} 銷貨毛利`} value={fmtMoney(report.grossProfit)} hint={`毛利率 ${fmtPct(report.grossMarginPct)}`} href={`/reports?month=${month}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="待分裝需求" description="規劃中的分裝生產單（含接單後分裝）" action={<A href="/production">全部</A>} />
          <SimpleTable
            head={["生產單", "SKU", "數量", "類型", "預計日期"]}
            rows={plannedPOs.map((p) => [
              <A key="a" href={`/production/${p.id}`}>
                {p.orderNo}
              </A>,
              p.targetVariant.sku,
              p.plannedQty,
              p.salesOrderItem ? <Badge tone="warning">訂單 {p.salesOrderItem.order.orderNo}</Badge> : "預先分裝",
              fmtDbDate(p.plannedDate),
            ])}
            empty="目前沒有待分裝需求"
          />
        </Card>
        <Card>
          <CardHeader title="即將到期批次" description={`商品標示有效日期在 ${settings.inventory.expiryWarnDays} 天內（非最佳風味期）`} />
          <SimpleTable
            head={["批次", "品項", "在庫", "有效日期"]}
            rows={warnLots.map((l) => [
              <A key="a" href={`/inventory/lots/${l.id}`}>
                {l.lotCode}
              </A>,
              l.item.name,
              l.item.unit === "G" ? fmtGrams(l.onHand) : `${fmtNum(l.onHand, 0)} 件`,
              fmtDbDate(l.expiryDate),
            ])}
            empty="沒有即將到期的批次"
          />
        </Card>
        <Card>
          <CardHeader title="未付款訂單" action={<A href="/orders?pay=open">全部</A>} />
          <SimpleTable
            head={["訂單", "顧客", "金額", "付款"]}
            rows={unpaid.slice(0, 6).map((o) => [
              <A key="a" href={`/orders/${o.id}`}>
                {o.orderNo}
              </A>,
              o.customerName,
              fmtMoney(o.total),
              <StatusBadge key="s" map={PAYMENT} value={o.paymentStatus} />,
            ])}
            empty="沒有未付款訂單"
          />
        </Card>
        <Card>
          <CardHeader title="待出貨訂單" action={<A href="/orders?ful=READY_TO_SHIP">全部</A>} />
          <SimpleTable
            head={["訂單", "顧客", "金額", "狀態"]}
            rows={ready.slice(0, 6).map((o) => [
              <A key="a" href={`/orders/${o.id}`}>
                {o.orderNo}
              </A>,
              o.customerName,
              fmtMoney(o.total),
              <StatusBadge key="s" map={FULFILL} value={o.fulfillmentStatus} />,
            ])}
            empty="沒有待出貨訂單"
          />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="最近烘焙" action={<A href="/roasting">全部</A>} />
          <CardBody className="space-y-3">
            {roasts.length === 0 && <p className="text-sm text-muted">尚無烘焙紀錄</p>}
            {roasts.map((r) => (
              <Link key={r.id} href={`/roasting/${r.id}`} className="block rounded-lg p-2 hover:bg-surface-2">
                <p className="text-sm font-medium">{r.greenLot.coffee.nameZh}</p>
                <p className="num text-xs text-muted">
                  {r.batchNo} · {fmtDate(r.roastedAt)} · 失重 {fmtPct(r.weightLossPercent)} · DTR {fmtPct(r.dtrPercent)}
                </p>
              </Link>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="最近杯測" action={<A href="/cupping">全部</A>} />
          <CardBody className="space-y-3">
            {cuppings.length === 0 && <p className="text-sm text-muted">尚無杯測紀錄</p>}
            {cuppings.map((c) => (
              <Link key={c.id} href={`/cupping/${c.id}`} className="block rounded-lg p-2 hover:bg-surface-2">
                <p className="text-sm font-medium">{c.roastBatch.greenLot.coffee.nameZh}</p>
                <p className="num text-xs text-muted">
                  {fmtDate(c.cuppedAt)} · 烘後 {c.restDays} 天 · 平均 {fmtNum(c.totalScore, 2)}
                </p>
              </Link>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="最近手沖實驗" action={<A href="/brewing">全部</A>} />
          <CardBody className="space-y-3">
            {brews.length === 0 && <p className="text-sm text-muted">尚無手沖紀錄</p>}
            {brews.map((b) => (
              <Link key={b.id} href={`/brewing/${b.id}`} className="block rounded-lg p-2 hover:bg-surface-2">
                <p className="text-sm font-medium">{b.roastBatch.greenLot.coffee.nameZh}</p>
                <p className="num text-xs text-muted">
                  {fmtDate(b.brewedAt)} · 烘後 {restDays(b.roastBatch.roastedAt, b.brewedAt)} 天 · 1:{fmtNum(b.ratio, 1)} · 評分 {fmtNum(b.rating, 1)}
                </p>
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
