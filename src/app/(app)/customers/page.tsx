"use client";

import { D, fmtMoney } from "@/lib/decimal";
import { fmtDate } from "@/lib/time";
import { useCol } from "@/lib/data";
import { Guard } from "@/lib/page";
import { DataTable } from "@/components/data-table";
import { LinkButton, PageHeader } from "@/components/ui";

export default function CustomersPage() {
  const cs = useCol("customers", [], "createdAt");
  const orders = useCol("orders");
  return (
    <>
      <PageHeader title="顧客" description="顧客個資僅供後台使用，不會出現在 QR 履歷或追溯報表" actions={<LinkButton href="/customers/new/">＋ 新增顧客</LinkButton>} />
      <Guard loading={cs.loading} error={cs.error}>
        {() => (
          <DataTable
            columns={[
              { key: "name", label: "顧客", sortable: true },
              { key: "phone", label: "電話" },
              { key: "orders", label: "訂單數", align: "right", sortable: true },
              { key: "spent", label: "累計金額", align: "right", sortable: true },
              { key: "last", label: "最近下單", sortable: true, hideOnMobile: true },
            ]}
            rows={cs.data.map((c) => {
              const os = orders.data.filter((o) => o.customerId === c.id && o.fulfillmentStatus !== "CANCELLED");
              const spent = os.reduce((s, o) => s.add(o.total), D(0));
              const last = os.map((o) => o.orderedAt).sort().pop();
              return { id: c.id, href: `/customers/view/?id=${c.id}`, search: [c.code, c.name, c.phone, c.email, c.address].join(" "), sort: { name: c.name, orders: os.length, spent: spent.toNumber(), last: last ?? null }, cells: { name: `${c.name}（${c.code}）`, phone: c.phone ?? "—", orders: os.length, spent: fmtMoney(spent), last: fmtDate(last) } };
            })}
          />
        )}
      </Guard>
    </>
  );
}
