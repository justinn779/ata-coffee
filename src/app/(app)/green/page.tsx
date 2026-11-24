"use client";

import { D, fmtGrams, fmtMoney, fmtMoney2, fmtPct } from "@/lib/decimal";
import { fmtDbDate } from "@/lib/time";
import { useCol } from "@/lib/data";
import { Guard } from "@/lib/page";
import { DataTable } from "@/components/data-table";
import { LinkButton, PageHeader } from "@/components/ui";

export default function GreenPage() {
  const g = useCol("greenLots", [], "receivedAt");
  const lots = useCol("invLots", [["kind", "GREEN"]]);
  const remain = (id: string) => lots.data.find((l) => l.id === id)?.onHand;
  return (
    <>
      <PageHeader title="生豆來源" description="每個採購批次固定其入庫成本，並透過庫存帳本追蹤每一筆領料" back={{ href: "/coffees/", label: "咖啡豆" }} actions={<LinkButton href="/green/new/">＋ 新增生豆採購</LinkButton>} />
      <Guard loading={g.loading} error={g.error}>
        {() => (
          <DataTable
            columns={[
              { key: "lot", label: "批次編號", sortable: true },
              { key: "coffee", label: "咖啡豆" },
              { key: "date", label: "採購日", sortable: true, hideOnMobile: true },
              { key: "received", label: "入庫量", align: "right" },
              { key: "remain", label: "剩餘", align: "right", sortable: true },
              { key: "cost", label: "每克成本", align: "right", sortable: true },
              { key: "total", label: "採購總額", align: "right", hideOnMobile: true },
              { key: "moisture", label: "含水率", align: "right", hideOnMobile: true },
            ]}
            filters={[{ key: "supplier", label: "供應商", options: [...new Map(g.data.filter((x) => x.supplierId).map((x) => [x.supplierId, x.supplierName])).entries()].map(([value, label]) => ({ value, label })) }]}
            rows={g.data.map((x) => ({
              id: x.id,
              href: `/inventory/lot/?id=${x.invLotId}`,
              search: [x.lotCode, x.coffeeName, x.purchaseNo, x.supplierName, x.invoiceNo].join(" "),
              filters: { supplier: x.supplierId ?? "" },
              sort: { lot: x.lotCode, date: x.purchaseDate, remain: Number(remain(x.invLotId) ?? 0), cost: Number(x.costPerG) },
              cells: {
                lot: x.lotCode,
                coffee: x.coffeeName,
                date: fmtDbDate(x.purchaseDate),
                received: fmtGrams(x.receivedWeightG),
                remain: fmtGrams(remain(x.invLotId)),
                cost: fmtMoney2(x.costPerG),
                total: fmtMoney(D(x.purchasedWeightG).div(1000).mul(x.unitPricePerKg).add(x.shippingCost).add(x.otherCost)),
                moisture: fmtPct(x.moisturePercent),
              },
            }))}
          />
        )}
      </Guard>
    </>
  );
}
