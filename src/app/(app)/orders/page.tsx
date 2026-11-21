import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/decimal";
import { fmtDateTime } from "@/lib/time";
import { FULFILL, PAYMENT } from "@/lib/labels";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status";
import { LinkButton, PageHeader, Tabs } from "@/components/ui";

export const metadata = { title: "訂單管理" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ pay?: string; ful?: string }> }) {
  const sp = await searchParams;
  const where: Prisma.SalesOrderWhereInput =
    sp.pay === "open" ? { paymentStatus: { in: ["UNPAID", "PENDING_CONFIRMATION"] }, fulfillmentStatus: { not: "CANCELLED" } } : sp.ful ? { fulfillmentStatus: sp.ful as never } : {};
  const orders = await prisma.salesOrder.findMany({ where, orderBy: { orderedAt: "desc" }, take: 1000, include: { _count: { select: { items: true } }, shipment: true } });
  const active = sp.pay === "open" ? "pay" : sp.ful ?? "all";
  return (
    <>
      <PageHeader title="訂單管理" description="付款狀態與履約狀態分開管理；建立訂單時即保留成品（不可超賣）" actions={<LinkButton href="/orders/new">＋ 建立手動訂單</LinkButton>} />
      <Tabs
        active={active}
        tabs={[
          { key: "all", label: "全部", href: "/orders" },
          { key: "pay", label: "未付款／待確認", href: "/orders?pay=open" },
          { key: "AWAITING_PACKAGING", label: "待分裝", href: "/orders?ful=AWAITING_PACKAGING" },
          { key: "READY_TO_SHIP", label: "可出貨", href: "/orders?ful=READY_TO_SHIP" },
          { key: "SHIPPED", label: "已出貨", href: "/orders?ful=SHIPPED" },
          { key: "RETURN_PROCESSING", label: "退貨處理中", href: "/orders?ful=RETURN_PROCESSING" },
        ]}
      />
      <DataTable
        columns={[
          { key: "no", label: "訂單編號", sortable: true },
          { key: "date", label: "下單時間", sortable: true, hideOnMobile: true },
          { key: "customer", label: "顧客" },
          { key: "total", label: "金額", align: "right", sortable: true },
          { key: "pay", label: "付款" },
          { key: "ful", label: "履約" },
          { key: "track", label: "物流", hideOnMobile: true },
        ]}
        filters={[
          { key: "pay", label: "付款狀態", options: Object.entries(PAYMENT).map(([value, [label]]) => ({ value, label })) },
          { key: "ful", label: "履約狀態", options: Object.entries(FULFILL).map(([value, [label]]) => ({ value, label })) },
          { key: "ch", label: "通路", options: [{ value: "MANUAL", label: "手動" }, { value: "WEB", label: "官網" }, { value: "OTHER", label: "其他" }] },
        ]}
        rows={orders.map((o) => ({
          id: o.id,
          href: `/orders/${o.id}`,
          search: [o.orderNo, o.customerName, o.customerPhone, o.externalRef, o.shipment?.trackingNo].join(" "),
          filters: { pay: o.paymentStatus, ful: o.fulfillmentStatus, ch: o.channel },
          sort: { no: o.orderNo, date: o.orderedAt.getTime(), total: Number(o.total) },
          cells: {
            no: o.orderNo,
            date: fmtDateTime(o.orderedAt),
            customer: o.customerName,
            total: fmtMoney(o.total),
            pay: <StatusBadge map={PAYMENT} value={o.paymentStatus} />,
            ful: <StatusBadge map={FULFILL} value={o.fulfillmentStatus} />,
            track: o.shipment?.trackingNo ?? "—",
          },
        }))}
      />
    </>
  );
}
