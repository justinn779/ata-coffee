"use client";

import { D, fmtMoney, fmtNum } from "@/lib/decimal";
import { PRODUCT_CATEGORY, PRODUCT_STATUS, STOCK_POLICY } from "@/lib/labels";
import { useCol } from "@/lib/data";
import { Guard } from "@/lib/page";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status";
import { Badge, LinkButton, PageHeader } from "@/components/ui";
import { useAvailability } from "./shared";

export default function ProductsPage() {
  const v = useCol("variants", [], "sku", false);
  const series = useCol("brandSeries");
  const avail = useAvailability();
  return (
    <>
      <PageHeader title="商品與品項" description="Product 與 ProductVariant 分離；可售量 = 可用成品批次（在庫 − 保留）；套組依組件計算可組數量" actions={<LinkButton href="/products/new/">＋ 新增商品</LinkButton>} />
      <Guard loading={v.loading} error={v.error}>
        {() => (
          <DataTable
            columns={[
              { key: "sku", label: "品項編號", sortable: true },
              { key: "name", label: "商品／規格" },
              { key: "cat", label: "分類", hideOnMobile: true },
              { key: "price", label: "售價", align: "right", sortable: true },
              { key: "avail", label: "可售", align: "right", sortable: true },
              { key: "policy", label: "庫存政策", hideOnMobile: true },
              { key: "status", label: "狀態" },
            ]}
            filters={[
              { key: "cat", label: "分類", options: Object.entries(PRODUCT_CATEGORY).map(([value, label]) => ({ value, label })) },
              { key: "status", label: "狀態", options: Object.entries(PRODUCT_STATUS).map(([value, [label]]) => ({ value, label })) },
              { key: "series", label: "系列", options: series.data.map((s) => ({ value: s.id, label: s.code })) },
            ]}
            rows={v.data.map((x) => {
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
