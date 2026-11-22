"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { D, fmtGrams, fmtMoney, fmtNum, fmtPct } from "@/lib/decimal";
import { currentMonthTaipei, fmtDate, fmtDbDate, addDaysYmd } from "@/lib/time";
import { FULFILL, PAYMENT } from "@/lib/labels";
import { useCol, useDocument, useOp } from "@/lib/data";
import { useQS } from "@/lib/page";
import { A, Badge, Card, CardBody, CardHeader, LinkButton, PageHeader, SimpleTable, StatCard } from "@/components/ui";
import { StatusBadge } from "@/components/status";
import type { MonthlyReport } from "../../../functions/src/domain/reports";

export default function Dashboard() {
  const router = useRouter();
  const m = useQS("month");
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : currentMonthTaipei();
  const lots = useCol("invLots");
  const items = useCol("invItems");
  const inv = useDocument("settings", "inventory");
  const pos = useCol("productionOrders", [["status", "PLANNED"]], "plannedDate", false);
  const orders = useCol("orders", [], "orderedAt", false);
  const roasts = useCol("roastBatches", [], "roastedAt");
  const cups = useCol("cuppingSessions", [], "cuppedAt");
  const brews = useCol("brewSessions", [], "brewedAt");
  const report = useOp<MonthlyReport>("report.monthly", { month });

  const s = { lowGreenG: 3000, lowRoastedG: 500, lowFinishedPcs: 5, expiryWarnDays: 14, ...(inv.data ?? {}) };
  const avail = lots.data.filter((l) => l.status === "AVAILABLE");
  const sum = (kind: string, f: "onHand" | "reserved" | "available") => avail.filter((l) => l.kind === kind).reduce((t, l) => t.add(f === "available" ? D(l.onHand).sub(l.reserved) : D(l[f])), D(0));
  const defLow: Record<string, number> = { GREEN: s.lowGreenG, ROASTED: s.lowRoastedG, FINISHED: s.lowFinishedPcs, MATERIAL: 0 };
  const low = items.data.filter((i) => {
    const a = avail.filter((l) => l.itemId === i.id).reduce((t, l) => t.add(D(l.onHand).sub(l.reserved)), D(0));
    const th = i.lowStockThreshold != null ? D(i.lowStockThreshold) : D(defLow[i.kind] ?? 0);
    return th.gt(0) && a.lt(th);
  });
  const warnBefore = addDaysYmd(new Date(), Number(s.expiryWarnDays));
  const expiring = avail.filter((l) => D(l.onHand).gt(0) && l.expiryDate && l.expiryDate <= warnBefore).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)).slice(0, 8);
  const unpaid = orders.data.filter((o) => ["UNPAID", "PENDING_CONFIRMATION"].includes(o.paymentStatus) && o.fulfillmentStatus !== "CANCELLED");
  const ready = orders.data.filter((o) => o.fulfillmentStatus === "READY_TO_SHIP");
  const r = report.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`今日概況與 ${month} 經營數字（Asia/Taipei）`}
        actions={
          <label className="flex items-center gap-2 text-xs text-muted">
            報表月份
            <input type="month" value={month} onChange={(e) => router.push(`/?month=${e.target.value}`)} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm text-fg" />
          </label>
        }
      />
      <section aria-label="快速新增" className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {[
          ["/green/new/", "＋ 生豆採購"],
          ["/roasting/new/", "＋ 開始烘焙"],
          ["/cupping/new/", "＋ 杯測"],
          ["/brewing/new/", "＋ 手沖紀錄"],
          ["/production/new/", "＋ 分裝單"],
          ["/orders/new/", "＋ 手動訂單"],
          ["/inventory/", "查看庫存"],
        ].map(([href, label]) => (
          <LinkButton key={href} href={href} variant={href === "/orders/new/" ? "primary" : "outline"} size="sm">
            {label}
          </LinkButton>
        ))}
      </section>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="生豆總庫存" value={fmtGrams(sum("GREEN", "onHand"))} hint={`可用 ${fmtGrams(sum("GREEN", "available"))}`} href="/inventory/?kind=GREEN" />
        <StatCard label="熟豆總庫存" value={fmtGrams(sum("ROASTED", "onHand"))} hint={`已預留分裝 ${fmtGrams(sum("ROASTED", "reserved"))}`} href="/inventory/?kind=ROASTED" />
        <StatCard label="成品庫存" value={`${fmtNum(sum("FINISHED", "onHand"), 0)} 件`} hint={`可售 ${fmtNum(sum("FINISHED", "available"), 0)} 件`} href="/inventory/?kind=FINISHED" />
        <StatCard label="低庫存提醒" value={`${low.length} 項`} tone={low.length ? "warning" : "sage"} hint={low.slice(0, 2).map((l) => String(l.name).split("｜").pop()).join("、") || "庫存充足"} href="/inventory/?low=1" />
        <StatCard label="未付款／待確認訂單" value={`${unpaid.length} 筆`} tone={unpaid.length ? "danger" : "sage"} href="/orders/?pay=open" />
        <StatCard label="待出貨訂單" value={`${ready.length} 筆`} tone={ready.length ? "info" : "sage"} href="/orders/?ful=READY_TO_SHIP" />
        <StatCard label={`${month} 營收（商品淨額）`} value={r ? fmtMoney(r.netSales) : "…"} hint={r ? `${r.orderCount} 筆出貨訂單` : report.error ?? "計算中"} href={`/reports/?month=${month}`} />
        <StatCard label={`${month} 銷貨毛利`} value={r ? fmtMoney(r.grossProfit) : "…"} hint={r ? `毛利率 ${fmtPct(r.grossMarginPct)}` : ""} href={`/reports/?month=${month}`} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="待分裝需求" description="規劃中的分裝生產單（含接單後分裝）" action={<A href="/production/">全部</A>} />
          <SimpleTable
            head={["生產單", "品項編號", "數量", "類型", "預計日期"]}
            rows={pos.data.map((p) => [<A key="a" href={`/production/view/?id=${p.id}`}>{p.orderNo}</A>, p.sku, p.plannedQty, p.orderId ? <Badge key="b" tone="warning">接單後分裝</Badge> : "預先分裝", fmtDbDate(p.plannedDate)])}
            empty={pos.loading ? "載入中…" : "目前沒有待分裝需求"}
          />
        </Card>
        <Card>
          <CardHeader title="即將到期批次" description={`商品標示有效日期在 ${s.expiryWarnDays} 天內（非最佳風味期）`} />
          <SimpleTable head={["批次", "品項", "在庫", "有效日期"]} rows={expiring.map((l) => [<A key="a" href={`/inventory/lot/?id=${l.id}`}>{l.lotCode}</A>, l.itemName, l.unit === "G" ? fmtGrams(l.onHand) : `${fmtNum(l.onHand, 0)} 件`, fmtDbDate(l.expiryDate)])} empty="沒有即將到期的批次" />
        </Card>
        <Card>
          <CardHeader title="未付款訂單" action={<A href="/orders/?pay=open">全部</A>} />
          <SimpleTable head={["訂單", "顧客", "金額", "付款"]} rows={unpaid.slice(0, 6).map((o) => [<A key="a" href={`/orders/view/?id=${o.id}`}>{o.orderNo}</A>, o.customerName, fmtMoney(o.total), <StatusBadge key="s" map={PAYMENT} value={o.paymentStatus} />])} empty="沒有未付款訂單" />
        </Card>
        <Card>
          <CardHeader title="待出貨訂單" action={<A href="/orders/?ful=READY_TO_SHIP">全部</A>} />
          <SimpleTable head={["訂單", "顧客", "金額", "狀態"]} rows={ready.slice(0, 6).map((o) => [<A key="a" href={`/orders/view/?id=${o.id}`}>{o.orderNo}</A>, o.customerName, fmtMoney(o.total), <StatusBadge key="s" map={FULFILL} value={o.fulfillmentStatus} />])} empty="沒有待出貨訂單" />
        </Card>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Recent title="最近烘焙" href="/roasting/" rows={roasts.data.slice(0, 5).map((x) => ({ href: `/roasting/view/?id=${x.id}`, title: x.coffeeName, sub: `${x.batchNo} · ${fmtDate(x.roastedAt)} · 失重 ${fmtPct(x.weightLossPercent)} · DTR ${fmtPct(x.dtrPercent)}` }))} empty="尚無烘焙紀錄" />
        <Recent title="最近杯測" href="/cupping/" rows={cups.data.slice(0, 5).map((x) => ({ href: `/cupping/view/?id=${x.id}`, title: x.coffeeName, sub: `${fmtDate(x.cuppedAt)} · 烘後 ${x.restDays} 天 · 平均 ${fmtNum(x.totalScore, 2)}` }))} empty="尚無杯測紀錄" />
        <Recent title="最近手沖實驗" href="/brewing/" rows={brews.data.slice(0, 5).map((x) => ({ href: `/brewing/view/?id=${x.id}`, title: x.coffeeName, sub: `${fmtDate(x.brewedAt)} · 烘後 ${x.restDays} 天 · 1:${fmtNum(x.ratio, 1)} · 評分 ${fmtNum(x.rating, 1)}` }))} empty="尚無手沖紀錄" />
      </div>
    </>
  );
}

function Recent({ title, href, rows, empty }: { title: string; href: string; rows: Array<{ href: string; title: string; sub: string }>; empty: string }) {
  return (
    <Card>
      <CardHeader title={title} action={<A href={href}>全部</A>} />
      <CardBody className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted">{empty}</p>}
        {rows.map((r) => (
          <Link key={r.href} href={r.href} className="block rounded-lg p-2 hover:bg-surface-2">
            <p className="text-sm font-medium">{r.title}</p>
            <p className="num text-xs text-muted">{r.sub}</p>
          </Link>
        ))}
      </CardBody>
    </Card>
  );
}
