"use client";

import { D, fmtMoney, fmtNum } from "@/lib/decimal";
import { PRODUCT_CATEGORY, PRODUCT_STATUS, STOCK_POLICY } from "@/lib/labels";
import { useCol } from "@/lib/data";
import { Guard } from "@/lib/page";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status";
import { Badge, LinkButton, Notice, PageHeader } from "@/components/ui";
import { ActionDialog } from "@/components/action-dialog";
import { opAction } from "@/lib/api";
import { useAvailability } from "./shared";

export default function ProductsPage() {
  const v = useCol("variants", [], "sku", false);
  const series = useCol("brandSeries");
  const products = useCol("products");
  // 商品已刪除、卻還留著的規格（舊版刪除商品不會一起刪規格）
  const alive = new Set(products.data.map((p) => p.id));
  const orphans = products.loading ? [] : v.data.filter((x) => !alive.has(x.productId));
  const rowsData = products.loading ? v.data : v.data.filter((x) => alive.has(x.productId));
  const avail = useAvailability();
  return (
    <>
      <PageHeader title="商品" description="每個商品可以有好幾種規格（例：100g、200g）；可售＝已分裝好、還沒被訂單保留的包數" actions={<LinkButton href="/products/new/">＋ 新增商品</LinkButton>} />
      {orphans.length > 0 && (
        <div className="mb-4">
          <Notice tone="warning">
            <span className="flex flex-wrap items-center justify-between gap-3">
              有 {orphans.length} 個規格的商品已經刪除，但規格還留著（{orphans.map((x) => `${x.productName ?? ""}｜${x.name}`).join("、")}）。
              <ActionDialog label="清除這些規格" size="sm" variant="outline" title="清除殘留的規格？" description="只會刪除這些規格本身；用到它們的訂單、分裝紀錄、庫存都會保留。" confirmLabel="清除" action={opAction("variant.cleanOrphans")} successMessage="已清除" />
            </span>
          </Notice>
        </div>
      )}
      <Guard loading={v.loading} error={v.error}>
        {() => (
          <DataTable
            columns={[
              { key: "sku", label: "規格編號", sortable: true },
              { key: "name", label: "商品／規格" },
              { key: "cat", label: "分類", hideOnMobile: true },
              { key: "price", label: "售價", align: "right", sortable: true },
              { key: "avail", label: "可售", align: "right", sortable: true },
              { key: "policy", label: "庫存方式", hideOnMobile: true },
              { key: "status", label: "狀態" },
            ]}
            filters={[
              { key: "cat", label: "分類", options: Object.entries(PRODUCT_CATEGORY).map(([value, label]) => ({ value, label })) },
              { key: "status", label: "狀態", options: Object.entries(PRODUCT_STATUS).map(([value, [label]]) => ({ value, label })) },
              { key: "series", label: "系列", options: series.data.map((s) => ({ value: s.id, label: s.code })) },
            ]}
            rows={rowsData.map((x) => {
              const a = avail.get(x.id) ?? D(0);
              return {
                id: x.id,
                href: `/products/view/?id=${x.productId}`,
                search: [x.sku, x.name, x.productName].join(" "),
                filters: { cat: x.category, status: x.status, series: x.brandSeriesId ?? "" },
                sort: { sku: x.sku, price: Number(x.salePrice), avail: a.toNumber() },
                cells: {
                  sku: x.sku,
                  name: <span>{x.productName}｜{x.name} {x.isBundle && <Badge tone="info">套組</Badge>} {x.isLimited && <Badge tone="primary">限定</Badge>}</span>,
                  cat: PRODUCT_CATEGORY[x.category],
                  price: fmtMoney(x.salePrice),
                  avail: x.stockPolicy === "NOT_TRACKED" ? "—" : `${fmtNum(a, 0)} 件`,
                  policy: STOCK_POLICY[x.stockPolicy],
                  status: <StatusBadge map={PRODUCT_STATUS} value={x.status} />,
                },
              };
            })}
          />
        )}
      </Guard>
    </>
  );
}
