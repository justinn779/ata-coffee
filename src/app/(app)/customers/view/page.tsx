"use client";

import { fmtMoney } from "@/lib/decimal";
import { fmtDateTime } from "@/lib/time";
import { FULFILL, PAYMENT } from "@/lib/labels";
import { useCol, useDocument } from "@/lib/data";
import { Guard, useQS } from "@/lib/page";
import { StatusBadge } from "@/components/status";
import { A, Card, CardHeader, LinkButton, PageHeader, SimpleTable } from "@/components/ui";
import { CustomerForm } from "../customer-form";

export default function CustomerDetail() {
  const id = useQS("id");
  const c = useDocument("customers", id);
  const orders = useCol("orders", [["customerId", id]], "orderedAt");
  return (
    <Guard loading={c.loading} error={c.error} missing={!c.data}>
      {() => (
        <>
          <PageHeader title={c.data!.name} description={c.data!.code} back={{ href: "/customers/", label: "顧客" }} actions={<LinkButton href={`/orders/new/?customer=${id}`}>＋ 為此顧客建立訂單</LinkButton>} />
          <div className="grid gap-6">
            <CustomerForm initial={c.data!} />
            <Card>
              <CardHeader title="訂單紀錄" />
              <SimpleTable head={["訂單", "時間", "金額", "付款", "履約"]} rows={orders.data.map((o) => [<A key="o" href={`/orders/view/?id=${o.id}`}>{o.orderNo}</A>, fmtDateTime(o.orderedAt), fmtMoney(o.total), <StatusBadge key="p" map={PAYMENT} value={o.paymentStatus} />, <StatusBadge key="f" map={FULFILL} value={o.fulfillmentStatus} />])} empty="尚無訂單" />
            </Card>
          </div>
        </>
      )}
    </Guard>
  );
}
