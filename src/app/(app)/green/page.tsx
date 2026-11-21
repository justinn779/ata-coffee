import { prisma } from "@/lib/db";
import { fmtGrams, fmtMoney, fmtMoney2, fmtPct, D } from "@/lib/decimal";
import { fmtDbDate } from "@/lib/time";
import { DataTable } from "@/components/data-table";
import { LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "生豆採購批次" };

export default async function GreenPage() {
  const lots = await prisma.greenBeanLot.findMany({
    orderBy: { receivedAt: "desc" },
    include: { coffee: true, purchase: { include: { supplier: true } }, inventoryLot: true, location: true },
  });
  return (
    <>
      <PageHeader title="生豆採購批次" description="每個採購批次固定其入庫成本，並透過庫存帳本追蹤每一筆領料" back={{ href: "/coffees", label: "咖啡豆資料" }} actions={<LinkButton href="/green/new">＋ 新增生豆採購</LinkButton>} />
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
        filters={[{ key: "supplier", label: "供應商", options: [...new Map(lots.filter((l) => l.purchase.supplier).map((l) => [l.purchase.supplier!.id, l.purchase.supplier!.name])).entries()].map(([value, label]) => ({ value, label })) }]}
        rows={lots.map((g) => {
          const total = D(g.purchasedWeightG).div(1000).mul(g.unitPricePerKg).add(g.shippingCost).add(g.otherCost);
          return {
            id: g.id,
            href: g.inventoryLot ? `/inventory/lots/${g.inventoryLot.id}` : undefined,
            search: [g.lotCode, g.coffee.nameZh, g.coffee.code, g.purchase.purchaseNo, g.purchase.supplier?.name, g.purchase.invoiceNo].join(" "),
            filters: { supplier: g.purchase.supplierId ?? "" },
            sort: { lot: g.lotCode, date: g.purchase.purchaseDate.getTime(), remain: Number(g.inventoryLot?.onHand ?? 0), cost: Number(g.costPerG) },
            cells: {
              lot: g.lotCode,
              coffee: g.coffee.nameZh,
              date: fmtDbDate(g.purchase.purchaseDate),
              received: fmtGrams(g.receivedWeightG),
              remain: fmtGrams(g.inventoryLot?.onHand),
              cost: fmtMoney2(g.costPerG),
              total: fmtMoney(total),
              moisture: fmtPct(g.moisturePercent),
            },
          };
        })}
      />
    </>
  );
}
