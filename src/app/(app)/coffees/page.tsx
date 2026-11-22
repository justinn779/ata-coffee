"use client";

import { D, fmtGrams } from "@/lib/decimal";
import { useCol } from "@/lib/data";
import { Guard } from "@/lib/page";
import { DataTable } from "@/components/data-table";
import { Badge, EmptyState, LinkButton, PageHeader } from "@/components/ui";

export default function CoffeesPage() {
  const coffees = useCol("coffees", [], "code", false);
  const lots = useCol("invLots");
  const greens = useCol("greenLots");
  const stock = (coffeeId: string, kind: string) => lots.data.filter((l) => l.coffeeId === coffeeId && l.kind === kind && l.status === "AVAILABLE").reduce((s, l) => s.add(l.onHand), D(0));
  return (
    <>
      <PageHeader title="生豆資訊" description="咖啡豆主檔；同一咖啡豆可對應多個生豆採購批次" actions={<><LinkButton href="/green/" variant="outline">生豆來源</LinkButton><LinkButton href="/coffees/new/">＋ 新增咖啡豆</LinkButton></>} />
      <Guard loading={coffees.loading} error={coffees.error}>
        {() =>
          coffees.data.length === 0 ? (
            <EmptyState title="尚未建立咖啡豆" description="先建立咖啡豆主檔，再新增生豆採購" action={<LinkButton href="/coffees/new/">新增咖啡豆</LinkButton>} />
          ) : (
            <DataTable
              columns={[
                { key: "name", label: "名稱", sortable: true },
                { key: "origin", label: "產地" },
                { key: "process", label: "處理法", hideOnMobile: true },
                { key: "lots", label: "採購批次", align: "right", sortable: true },
                { key: "green", label: "生豆庫存", align: "right", sortable: true },
                { key: "roasted", label: "熟豆庫存", align: "right", sortable: true },
              ]}
              filters={[
                { key: "process", label: "處理法", options: [...new Set(coffees.data.map((c) => c.process).filter(Boolean))].map((p) => ({ value: p, label: p })) },
                { key: "status", label: "狀態", options: [{ value: "active", label: "使用中" }, { value: "archived", label: "已封存" }] },
              ]}
              rows={coffees.data.map((c) => {
                const g = stock(c.id, "GREEN");
                const r = stock(c.id, "ROASTED");
                const n = greens.data.filter((x) => x.coffeeId === c.id).length;
                return {
                  id: c.id,
                  href: `/coffees/view/?id=${c.id}`,
                  search: [c.code, c.nameZh, c.nameEn, c.country, c.region, c.farm, c.variety, c.process, c.supplierName].join(" "),
                  filters: { process: c.process ?? "", status: c.archivedAt ? "archived" : "active" },
                  sort: { name: c.code, lots: n, green: g.toNumber(), roasted: r.toNumber() },
                  cells: {
                    name: (
                      <span>
                        {c.nameZh} <span className="text-xs text-muted">{c.code}</span> {c.archivedAt && <Badge>封存</Badge>}
                      </span>
                    ),
                    origin: [c.country, c.region].filter(Boolean).join("・") || "—",
                    process: c.process ?? "—",
                    lots: n,
                    green: fmtGrams(g),
                    roasted: fmtGrams(r),
                  },
                };
              })}
            />
          )
        }
      </Guard>
    </>
  );
}
