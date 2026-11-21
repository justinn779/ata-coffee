"use client";

import { D, fmtGrams } from "@/lib/decimal";
import { fmtDbDate } from "@/lib/time";
import { PROD_MODE, PROD_STATUS } from "@/lib/labels";
import { useCol } from "@/lib/data";
import { Guard } from "@/lib/page";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status";
import { LinkButton, PageHeader } from "@/components/ui";

export default function ProductionPage() {
  const pos = useCol("productionOrders", [], "plannedDate");
  return (
    <>
      <PageHeader title="分裝生產" description="建立時預留熟豆；完成時同一交易扣熟豆與包材、產出成品並計算成本。不同烘焙批次不混批。" actions={<LinkButton href="/production/new/">＋ 新增分裝單</LinkButton>} />
      <Guard loading={pos.loading} error={pos.error}>
        {() => (
          <DataTable
            columns={[
              { key: "no", label: "生產單", sortable: true },
              { key: "status", label: "狀態" },
              { key: "mode", label: "類型", hideOnMobile: true },
              { key: "sku", label: "目標 SKU" },
              { key: "src", label: "熟豆批次", hideOnMobile: true },
              { key: "qty", label: "數量（計畫／實際）", align: "right" },
              { key: "beans", label: "耗豆", align: "right", hideOnMobile: true },
              { key: "date", label: "日期", sortable: true },
            ]}
            filters={[
              { key: "status", label: "狀態", options: Object.entries(PROD_STATUS).map(([value, [label]]) => ({ value, label })) },
              { key: "mode", label: "類型", options: Object.entries(PROD_MODE).map(([value, label]) => ({ value, label })) },
            ]}
            rows={[...pos.data].sort((a, b) => (a.status === "PLANNED" ? -1 : 0) - (b.status === "PLANNED" ? -1 : 0)).map((p) => ({
              id: p.id,
              href: `/production/view/?id=${p.id}`,
              search: [p.orderNo, p.sku, p.variantName, p.sourceLotCode].join(" "),
              filters: { status: p.status, mode: p.mode },
              sort: { no: p.orderNo, date: p.plannedDate },
              cells: {
                no: p.orderNo,
                status: <StatusBadge map={PROD_STATUS} value={p.status} />,
                mode: PROD_MODE[p.mode],
                sku: p.sku,
                src: p.sourceLotCode,
                qty: `${p.plannedQty}／${p.actualQty ?? "—"}`,
                beans: p.beansConsumedG ? fmtGrams(p.beansConsumedG, 1) : `預留 ${fmtGrams(D(p.fillWeightG).mul(p.plannedQty), 1)}`,
                date: fmtDbDate(p.plannedDate),
              },
            }))}
          />
        )}
      </Guard>
    </>
  );
}
