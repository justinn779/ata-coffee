"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bean, Coffee, Flame, FlaskConical, Package, Plus, ShoppingBag } from "lucide-react";
import { D, fmtGrams, fmtMoney, fmtNum, fmtPct } from "@/lib/decimal";
import { currentMonthTaipei, fmtDate, fmtDbDate, addDaysYmd } from "@/lib/time";
import { FULFILL, PAYMENT } from "@/lib/labels";
import { useCol, useDocument, useOp } from "@/lib/data";
import { useQS } from "@/lib/page";
import { A, Badge, Card, CardBody, CardHeader, LinkButton, PageHeader, SimpleTable, StatCard } from "@/components/ui";
import { StatusBadge } from "@/components/status";
import { MODULES } from "@/components/nav";
import type { MonthlyReport } from "../../../functions/src/domain/reports";

/** 快速新增：[連結, 圖示, 短標籤, 完整說明（滑鼠提示）] */
const QUICK: Array<[string, typeof Bean, string, string]> = [
  ["/green/new/", Bean, "採購", "新增生豆採購"],
  ["/roasting/live/", Flame, "烘豆", "平板烘豆即時紀錄"],
  ["/cupping/new/", FlaskConical, "杯測", "新增杯測"],
  ["/brewing/new/", Coffee, "手沖", "新增手沖紀錄"],
  ["/production/new/", Package, "分裝", "新增分裝單"],
  ["/orders/new/", ShoppingBag, "訂單", "新增手動訂單"],
];

/** 卡片標題：短標題＋數量，完整說明放滑鼠提示 */
function Titled({ label, tip, n }: { label: string; tip?: string; n: number }) {
  return (
    <span title={tip} className="flex items-center gap-2">
      {label}
      <Badge tone="warning">{n}</Badge>
    </span>
  );
}

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
  const anyTodo = pos.data.length > 0 || expiring.length > 0 || unpaid.length > 0 || ready.length > 0;

  return (
    <>
      <PageHeader
        title="主畫面"
        actions={<input type="month" aria-label="報表月份" title="報表月份（台北時間）" value={month} onChange={(e) => router.push(`/?month=${e.target.value}`)} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm text-fg" />}
      />
      <FunctionGrid />
      <section aria-label="快速新增" className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {QUICK.map(([href, Icon, label, full]) => (
          <LinkButton key={href} href={href} title={full} aria-label={full} variant={href === "/orders/new/" ? "primary" : "outline"} size="sm" className="shrink-0 gap-1">
            <Plus size={14} aria-hidden />
            <Icon size={16} strokeWidth={1.75} aria-hidden />
            {label}
          </LinkButton>
        ))}
      </section>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="生豆" value={fmtGrams(sum("GREEN", "onHand"))} tip={`生豆總庫存；可用 ${fmtGrams(sum("GREEN", "available"))}`} href="/inventory/?kind=GREEN" />
        <StatCard label="熟豆" value={fmtGrams(sum("ROASTED", "onHand"))} tip={`熟豆總庫存；已預留分裝 ${fmtGrams(sum("ROASTED", "reserved"))}`} href="/inventory/?kind=ROASTED" />
        <StatCard label="成品" value={`${fmtNum(sum("FINISHED", "onHand"), 0)} 件`} tip={`成品庫存；可售 ${fmtNum(sum("FINISHED", "available"), 0)} 件`} href="/inventory/?kind=FINISHED" />
        <StatCard label="低庫存" value={`${low.length} 項`} tone={low.length ? "warning" : "sage"} tip={low.map((l) => String(l.name).split("｜").pop()).join("、") || "庫存充足"} href="/inventory/?low=1" />
        <StatCard label="未付款" value={`${unpaid.length} 筆`} tone={unpaid.length ? "danger" : "sage"} tip="未付款或待確認匯款的訂單" href="/orders/?pay=open" />
        <StatCard label="待出貨" value={`${ready.length} 筆`} tone={ready.length ? "info" : "sage"} tip="已備貨、等待出貨的訂單" href="/orders/?ful=READY_TO_SHIP" />
        <StatCard label="本月營收" value={r ? fmtMoney(r.netSales) : "…"} tip={r ? `${month} 商品淨額；${r.orderCount} 筆出貨訂單` : (report.error ?? "計算中")} href={`/reports/?month=${month}`} />
        <StatCard label="本月毛利" value={r ? fmtMoney(r.grossProfit) : "…"} tip={r ? `${month} 銷貨毛利；毛利率 ${fmtPct(r.grossMarginPct)}` : undefined} href={`/reports/?month=${month}`} />
      </div>
      {anyTodo && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {pos.data.length > 0 && (
            <Card>
              <CardHeader title={<Titled label="待分裝" tip="規劃中的分裝生產單（含接單後分裝）" n={pos.data.length} />} action={<A href="/production/">全部</A>} />
              <SimpleTable head={["生產單", "品項", "數量", "日期"]} rows={pos.data.map((p) => [<A key="a" href={`/production/view/?id=${p.id}`}>{p.orderNo}</A>, p.sku, p.plannedQty, fmtDbDate(p.plannedDate)])} />
            </Card>
          )}
          {expiring.length > 0 && (
            <Card>
              <CardHeader title={<Titled label="即將到期" tip={`商品標示有效日期在 ${s.expiryWarnDays} 天內`} n={expiring.length} />} />
              <SimpleTable head={["批次", "品項", "在庫", "到期"]} rows={expiring.map((l) => [<A key="a" href={`/inventory/lot/?id=${l.id}`}>{l.lotCode}</A>, l.itemName, l.unit === "G" ? fmtGrams(l.onHand) : `${fmtNum(l.onHand, 0)} 件`, fmtDbDate(l.expiryDate)])} />
            </Card>
          )}
          {unpaid.length > 0 && (
            <Card>
              <CardHeader title={<Titled label="未付款" tip="未付款或待確認匯款" n={unpaid.length} />} action={<A href="/orders/?pay=open">全部</A>} />
              <SimpleTable head={["訂單", "顧客", "金額", "付款"]} rows={unpaid.slice(0, 6).map((o) => [<A key="a" href={`/orders/view/?id=${o.id}`}>{o.orderNo}</A>, o.customerName, fmtMoney(o.total), <StatusBadge key="s" map={PAYMENT} value={o.paymentStatus} />])} />
            </Card>
          )}
          {ready.length > 0 && (
            <Card>
              <CardHeader title={<Titled label="待出貨" n={ready.length} />} action={<A href="/orders/?ful=READY_TO_SHIP">全部</A>} />
              <SimpleTable head={["訂單", "顧客", "金額", "狀態"]} rows={ready.slice(0, 6).map((o) => [<A key="a" href={`/orders/view/?id=${o.id}`}>{o.orderNo}</A>, o.customerName, fmtMoney(o.total), <StatusBadge key="s" map={FULFILL} value={o.fulfillmentStatus} />])} />
            </Card>
          )}
        </div>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Recent title="最近烘豆" href="/roasting/" rows={roasts.data.slice(0, 5).map((x) => ({ href: `/roasting/view/?id=${x.id}`, title: x.coffeeName, sub: fmtDate(x.roastedAt), tip: `${x.batchNo}・失重 ${fmtPct(x.weightLossPercent)}・DTR ${fmtPct(x.dtrPercent)}` }))} />
        <Recent title="最近杯測" href="/cupping/" rows={cups.data.slice(0, 5).map((x) => ({ href: `/cupping/view/?id=${x.id}`, title: x.coffeeName, sub: fmtDate(x.cuppedAt), tip: `烘後 ${x.restDays ?? "—"} 天・平均 ${fmtNum(x.totalScore, 2)}` }))} />
        <Recent title="最近手沖" href="/brewing/" rows={brews.data.slice(0, 5).map((x) => ({ href: `/brewing/view/?id=${x.id}`, title: x.coffeeName, sub: fmtDate(x.brewedAt), tip: `烘後 ${x.restDays ?? "—"} 天・1:${fmtNum(x.ratio, 1)}・評分 ${fmtNum(x.rating, 1)}` }))} />
      </div>
    </>
  );
}

function Recent({ title, href, rows }: { title: string; href: string; rows: Array<{ href: string; title: string; sub: string; tip: string }> }) {
  return (
    <Card>
      <CardHeader title={title} action={<A href={href}>全部</A>} />
      <CardBody className="space-y-1">
        {rows.length === 0 && <p className="text-sm text-muted">—</p>}
        {rows.map((r) => (
          <Link key={r.href} href={r.href} title={r.tip} className="flex items-baseline justify-between gap-3 rounded-lg p-2 hover:bg-surface-2">
            <span className="truncate text-sm font-medium">{r.title}</span>
            <span className="num shrink-0 text-xs text-muted">{r.sub}</span>
          </Link>
        ))}
      </CardBody>
    </Card>
  );
}

/** 主功能入口：圖示＋名稱，說明放在滑鼠提示；下方為子功能 */
function FunctionGrid() {
  return (
    <section aria-label="功能" className="mb-6">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {MODULES.map((m) => {
          const Icon = m.icon;
          return (
            <li key={m.key} title={m.desc} className="flex flex-col rounded-xl border border-border bg-surface transition-colors hover:border-primary/50">
              <Link href={m.tabs[0].href} className="flex flex-1 items-center gap-3 rounded-xl p-4 hover:bg-primary-soft/40">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <Icon size={22} strokeWidth={1.75} aria-hidden />
                </span>
                <span className="font-medium">{m.label}</span>
              </Link>
              {m.tabs.length > 1 && (
                <div className="flex flex-wrap gap-1 px-3 pb-3">
                  {m.tabs.map((t) => (
                    <Link key={t.href} href={t.href} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-fg/75 hover:bg-primary-soft hover:text-primary">
                      {t.label}
                    </Link>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
