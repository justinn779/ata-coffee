import { prisma } from "@/lib/db";
import { D, fmtMoney, fmtNum } from "@/lib/decimal";
import { PRODUCT_CATEGORY, PRODUCT_STATUS, STOCK_POLICY } from "@/lib/labels";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status";
import { Badge, LinkButton, PageHeader } from "@/components/ui";
import { variantAvailability } from "./availability";

export const metadata = { title: "商品與 SKU" };

export default async function ProductsPage() {
  const variants = await prisma.productVariant.findMany({ include: { product: { include: { brandSeries: true } } }, orderBy: [{ product: { code: "asc" } }, { sku: "asc" }] });
  const avail = await variantAvailability();
  return (
    <>
      <PageHeader title="商品與 SKU" description="Product 與 ProductVariant 分離；可售量 = 可用成品批次（在庫 − 保留）；套組依組件計算可組數量" actions={<LinkButton href="/products/new">＋ 新增商品</LinkButton>} />
      <DataTable
        columns={[
          { key: "sku", label: "SKU", sortable: true },
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
          { key: "series", label: "系列", options: [...new Map(variants.filter((v) => v.product.brandSeries).map((v) => [v.product.brandSeries!.id, v.product.brandSeries!.code])).entries()].map(([value, label]) => ({ value, label })) },
        ]}
        rows={variants.map((v) => {
          const a = avail.get(v.id) ?? D(0);
          return {
            id: v.id,
            href: `/products/${v.productId}`,
            search: [v.sku, v.name, v.product.name, v.product.code, v.product.brandSeries?.code].join(" "),
            filters: { cat: v.product.category, status: v.status, series: v.product.brandSeriesId ?? "" },
            sort: { sku: v.sku, price: Number(v.salePrice), avail: a.toNumber() },
            cells: {
              sku: v.sku,
              name: (
                <span>
                  {v.product.name}｜{v.name} {v.isBundle && <Badge tone="info">套組</Badge>} {v.product.isLimited && <Badge tone="primary">限定</Badge>}
                </span>
              ),
              cat: PRODUCT_CATEGORY[v.product.category],
              price: fmtMoney(v.salePrice),
              avail: v.stockPolicy === "NOT_TRACKED" ? "—" : `${fmtNum(a, 0)} 件`,
              policy: STOCK_POLICY[v.stockPolicy],
              status: <StatusBadge map={PRODUCT_STATUS} value={v.status} />,
            },
          };
        })}
      />
    </>
  );
}
