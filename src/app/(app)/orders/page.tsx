"use client";

import { fmtMoney } from "@/lib/decimal";
import { fmtDateTime } from "@/lib/time";
import { FULFILL, PAYMENT } from "@/lib/labels";
import { useCol } from "@/lib/data";
import { Guard, useQS } from "@/lib/page";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status";
import { LinkButton, PageHeader, Tabs } from "@/components/ui";

export default function OrdersPage() {
  const pay = useQS("pay");
  const ful = useQS("ful");
  const o = useCol("orders", [], "orderedAt");
  const rows = o.data.filter((x) => (pay === "open" ? ["UNPAID", "PENDING_CONFIRMATION"].includes(x.paymentStatus) && x.fulfillmentStatus !== "CANCELLED" : ful ? x.fulfillmentStatus === ful : true));
  return (
    <>
      <PageHeader title="訂單管理" description="付款狀態與履約狀態分開管理；建立訂單時即保留成品（不可超賣）" actions={<LinkButton href="/orders/new/">＋ 建立手動訂單</LinkButton>} />
      <Tabs
        active={pay === "open" ? "pay" : (ful ?? "all")}
        tabs={[
          { key: "all", label: "全部", href: "/orders/" },
          { key: "pay", label: "未付款／待確認", href: "/orders/?pay=open" },
          { key: "AWAITING_PACKAGING", label: "待分裝", href: "/orders/?ful=AWAITING_PACKAGING" },
          { key: "READY_TO_SHIP", label: "可出貨", href: "/orders/?ful=READY_TO_SHIP" },
          { key: "SHIPPED", label: "已出貨", href: "/orders/?ful=SHIPPED" },
          { key: "RETURN_PROCESSING", label: "退貨處理中", href: "/orders/?ful=RETURN_PROCESSING" },
        ]}
      />
      <Guard loading={o.loading} error={o.error}>
        {() => (
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
            rows={rows.map((x) => ({
              id: x.id,
              href: `/orders/view/?id=${x.id}`,
              search: [x.orderNo, x.customerName, x.customerPhone, x.externalRef, x.shipment?.trackingNo].join(" "),
              filters: { pay: x.paymentStatus, ful: x.fulfillmentStatus, ch: x.channel },
              sort: { no: x.orderNo, date: x.orderedAt, total: Number(x.total) },
              cells: { no: x.orderNo, date: fmtDateTime(x.orderedAt), customer: x.customerName, total: fmtMoney(x.total), pay: <StatusBadge map={PAYMENT} value={x.paymentStatus} />, ful: <StatusBadge map={FULFILL} value={x.fulfillmentStatus} />, track: x.shipment?.trackingNo ?? "—" },
            }))}
          />
        )}
      </Guard>
    </>
  );
}
