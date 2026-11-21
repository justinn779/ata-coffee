import { prisma } from "@/lib/db";
import { D, fmtNum } from "@/lib/decimal";
import { fmtDateTime } from "@/lib/time";
import { KIND_LABEL, TX_LABEL } from "@/server/domain/inventory";
import { DataTable } from "@/components/data-table";
import { LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "庫存帳本" };

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ take?: string }> }) {
  const take = Math.min(Number((await searchParams).take ?? 1000) || 1000, 10000);
  const txs = await prisma.inventoryTransaction.findMany({ orderBy: { occurredAt: "desc" }, take, include: { item: true, lot: true, actor: true } });
  return (
    <>
      <PageHeader title="庫存帳本" description={`最近 ${txs.length} 筆異動（全部類別）。可匯出完整 CSV。`} back={{ href: "/inventory", label: "庫存中心" }} actions={<LinkButton href="/api/export/inventory-ledger" variant="outline" prefetch={false}>匯出 CSV</LinkButton>} />
      <DataTable
        pageSize={50}
        columns={[
          { key: "time", label: "時間", sortable: true },
          { key: "type", label: "類型" },
          { key: "kind", label: "類別", hideOnMobile: true },
          { key: "lot", label: "批次" },
          { key: "item", label: "品項", hideOnMobile: true },
          { key: "qty", label: "異動量", align: "right", sortable: true },
          { key: "bal", label: "結餘", align: "right", hideOnMobile: true },
          { key: "who", label: "操作者", hideOnMobile: true },
          { key: "note", label: "備註", hideOnMobile: true },
        ]}
        filters={[
          { key: "type", label: "類型", options: Object.entries(TX_LABEL).map(([value, label]) => ({ value, label })) },
          { key: "kind", label: "類別", options: Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })) },
        ]}
        rows={txs.map((t) => ({
          id: t.id,
          href: `/inventory/lots/${t.lotId}`,
          search: [t.id, t.lot.lotCode, t.item.name, t.note, TX_LABEL[t.type]].join(" "),
          filters: { type: t.type, kind: t.item.kind },
          sort: { time: t.occurredAt.getTime(), qty: Number(t.quantity) },
          cells: {
            time: fmtDateTime(t.occurredAt),
            type: TX_LABEL[t.type],
            kind: KIND_LABEL[t.item.kind],
            lot: t.lot.lotCode,
            item: t.item.name,
            qty: <span className={D(t.quantity).isNegative() ? "text-danger" : "text-sage"}>{D(t.quantity).isNegative() ? "" : "+"}{fmtNum(t.quantity, 1)} {t.unit === "G" ? "g" : "件"}</span>,
            bal: fmtNum(t.balanceAfter, 1),
            who: t.actor?.name ?? "系統",
            note: t.note ?? "—",
          },
        }))}
      />
    </>
  );
}
