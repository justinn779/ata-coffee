import { prisma } from "@/lib/db";
import { D, fmtMoney } from "@/lib/decimal";
import { fmtDate } from "@/lib/time";
import { DataTable } from "@/components/data-table";
import { LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "顧客" };

export default async function CustomersPage() {
  const cs = await prisma.customer.findMany({ orderBy: { createdAt: "desc" }, include: { orders: { where: { fulfillmentStatus: { not: "CANCELLED" } }, select: { total: true, orderedAt: true } } } });
  return (
    <>
      <PageHeader title="顧客" description="顧客個資僅供後台使用，不會出現在 QR 履歷或追溯報表" actions={<LinkButton href="/customers/new">＋ 新增顧客</LinkButton>} />
      <DataTable
        columns={[
          { key: "name", label: "顧客", sortable: true },
          { key: "phone", label: "電話" },
          { key: "orders", label: "訂單數", align: "right", sortable: true },
          { key: "spent", label: "累計金額", align: "right", sortable: true },
          { key: "last", label: "最近下單", sortable: true, hideOnMobile: true },
        ]}
        rows={cs.map((c) => {
          const spent = c.orders.reduce((s, o) => s.add(o.total), D(0));
          const last = c.orders.map((o) => o.orderedAt).sort((a, b) => b.getTime() - a.getTime())[0];
          return {
            id: c.id,
            href: `/customers/${c.id}`,
            search: [c.code, c.name, c.phone, c.email, c.address].join(" "),
            sort: { name: c.name, orders: c.orders.length, spent: spent.toNumber(), last: last?.getTime() ?? null },
            cells: { name: `${c.name}（${c.code}）`, phone: c.phone ?? "—", orders: c.orders.length, spent: fmtMoney(spent), last: fmtDate(last) },
          };
        })}
      />
    </>
  );
}
