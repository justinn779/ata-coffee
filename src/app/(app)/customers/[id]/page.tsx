import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/decimal";
import { fmtDateTime } from "@/lib/time";
import { FULFILL, PAYMENT } from "@/lib/labels";
import { StatusBadge } from "@/components/status";
import { A, Card, CardHeader, LinkButton, PageHeader, SimpleTable } from "@/components/ui";
import { CustomerForm } from "../customer-form";

export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.customer.findUnique({ where: { id }, include: { orders: { orderBy: { orderedAt: "desc" } } } });
  if (!c) notFound();
  return (
    <>
      <PageHeader title={c.name} description={c.code} back={{ href: "/customers", label: "顧客" }} actions={<LinkButton href={`/orders/new?customer=${c.id}`}>＋ 為此顧客建立訂單</LinkButton>} />
      <div className="grid gap-6">
        <CustomerForm initial={c} />
        <Card>
          <CardHeader title="訂單紀錄" />
          <SimpleTable head={["訂單", "時間", "金額", "付款", "履約"]} rows={c.orders.map((o) => [<A key="o" href={`/orders/${o.id}`}>{o.orderNo}</A>, fmtDateTime(o.orderedAt), fmtMoney(o.total), <StatusBadge key="p" map={PAYMENT} value={o.paymentStatus} />, <StatusBadge key="f" map={FULFILL} value={o.fulfillmentStatus} />])} empty="尚無訂單" />
        </Card>
      </div>
    </>
  );
}
