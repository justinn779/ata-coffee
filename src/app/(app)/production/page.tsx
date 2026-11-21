import { prisma } from "@/lib/db";
import { fmtGrams, fmtMoney2 } from "@/lib/decimal";
import { fmtDbDate } from "@/lib/time";
import { PROD_MODE, PROD_STATUS } from "@/lib/labels";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status";
import { LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "分裝生產" };

export default async function ProductionPage() {
  const pos = await prisma.productionOrder.findMany({
    orderBy: [{ status: "asc" }, { plannedDate: "desc" }],
    include: { targetVariant: { include: { product: true } }, sourceLot: true, packagingBatch: true, salesOrderItem: { include: { order: true } } },
  });
  return (
    <>
      <PageHeader title="分裝生產" description="建立時預留熟豆；完成時同一交易扣熟豆與包材、產出成品並計算成本。不同烘焙批次不混批。" actions={<LinkButton href="/production/new">＋ 新增分裝單</LinkButton>} />
      <DataTable
        columns={[
          { key: "no", label: "生產單", sortable: true },
          { key: "status", label: "狀態" },
          { key: "mode", label: "類型", hideOnMobile: true },
          { key: "sku", label: "目標 SKU" },
          { key: "src", label: "熟豆批次", hideOnMobile: true },
          { key: "qty", label: "數量（計畫／實際）", align: "right" },
          { key: "beans", label: "耗豆", align: "right", hideOnMobile: true },
          { key: "cost", label: "每件成本", align: "right", hideOnMobile: true },
          { key: "date", label: "日期", sortable: true },
        ]}
        filters={[
          { key: "status", label: "狀態", options: Object.entries(PROD_STATUS).map(([value, [label]]) => ({ value, label })) },
          { key: "mode", label: "類型", options: Object.entries(PROD_MODE).map(([value, label]) => ({ value, label })) },
        ]}
        rows={pos.map((p) => ({
          id: p.id,
          href: `/production/${p.id}`,
          search: [p.orderNo, p.targetVariant.sku, p.targetVariant.product.name, p.sourceLot.lotCode, p.salesOrderItem?.order.orderNo].join(" "),
          filters: { status: p.status, mode: p.mode },
          sort: { no: p.orderNo, date: p.plannedDate.getTime() },
          cells: {
            no: p.orderNo,
            status: <StatusBadge map={PROD_STATUS} value={p.status} />,
            mode: p.salesOrderItem ? `${PROD_MODE[p.mode]}（${p.salesOrderItem.order.orderNo}）` : PROD_MODE[p.mode],
            sku: p.targetVariant.sku,
            src: p.sourceLot.lotCode,
            qty: `${p.plannedQty}／${p.actualQty ?? "—"}`,
            beans: p.beansConsumedG ? fmtGrams(p.beansConsumedG, 1) : `預留 ${fmtGrams(Number(p.fillWeightG) * p.plannedQty, 1)}`,
            cost: p.packagingBatch ? fmtMoney2(p.packagingBatch.unitCost) : "—",
            date: fmtDbDate(p.plannedDate),
          },
        }))}
      />
    </>
  );
}
