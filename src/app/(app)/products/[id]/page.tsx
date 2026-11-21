import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D, fmtMoney, fmtMoney2, fmtNum } from "@/lib/decimal";
import { fmtDbDate } from "@/lib/time";
import { PRODUCT_CATEGORY, PRODUCT_STATUS, STOCK_POLICY } from "@/lib/labels";
import { StatusBadge } from "@/components/status";
import { A, Badge, Card, CardBody, CardHeader, KV, LinkButton, PageHeader, SimpleTable } from "@/components/ui";
import { variantAvailability } from "../availability";

export default async function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await prisma.product.findUnique({
    where: { id },
    include: {
      brandSeries: true,
      coffee: true,
      variants: {
        orderBy: { sku: "asc" },
        include: {
          materials: { include: { material: true } },
          bundleComponents: { include: { componentVariant: true } },
          inventoryItem: { include: { lots: { where: { onHand: { gt: 0 } }, orderBy: { createdAt: "desc" } } } },
        },
      },
    },
  });
  if (!p) notFound();
  const avail = await variantAvailability();
  return (
    <>
      <PageHeader
        title={p.name}
        description={`${p.code} · ${PRODUCT_CATEGORY[p.category]}`}
        back={{ href: "/products", label: "商品與 SKU" }}
        actions={
          <>
            <LinkButton href={`/products/${p.id}/variants/new`}>＋ 新增 SKU</LinkButton>
            <LinkButton href={`/products/${p.id}/edit`} variant="outline">
              編輯商品
            </LinkButton>
          </>
        }
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader title="商品資料" action={<StatusBadge map={PRODUCT_STATUS} value={p.status} />} />
          <CardBody>
            <KV
              cols={4}
              items={[
                ["品牌系列", p.brandSeries ? <A key="s" href={`/series/${p.brandSeries.id}`}>{p.brandSeries.code} {p.brandSeries.name}</A> : "—"],
                ["對應咖啡豆", p.coffee ? <A key="c" href={`/coffees/${p.coffee.id}`}>{p.coffee.nameZh}</A> : "—"],
                ["限定商品", p.isLimited ? "是" : "否"],
                ["販售期間", p.saleStartDate || p.saleEndDate ? `${fmtDbDate(p.saleStartDate)} ～ ${fmtDbDate(p.saleEndDate)}` : "不限"],
                ["風味說明", p.flavorNotes],
                ["商品介紹", p.description],
                ["商品圖片", "（尚未上傳；可於品牌素材管理上傳）"],
              ]}
            />
          </CardBody>
        </Card>
        {p.variants.map((v) => (
          <Card key={v.id}>
            <CardHeader
              title={
                <span>
                  {v.sku}｜{v.name} {v.isBundle && <Badge tone="info">套組</Badge>}
                </span>
              }
              description={STOCK_POLICY[v.stockPolicy]}
              action={<A href={`/products/${p.id}/variants/${v.id}`}>編輯</A>}
            />
            <CardBody className="space-y-4">
              <KV
                cols={4}
                items={[
                  ["原價／售價", `${fmtMoney(v.listPrice)}／${fmtMoney(v.salePrice)}`],
                  ["估計成本", fmtMoney2(v.standardCost)],
                  ["估計毛利", v.standardCost ? `${fmtMoney(D(v.salePrice).sub(v.standardCost))}（${fmtNum(D(v.salePrice).sub(v.standardCost).div(v.salePrice).mul(100), 1)}%）` : "—"],
                  ["可售", v.stockPolicy === "NOT_TRACKED" ? "不追蹤" : `${fmtNum(avail.get(v.id) ?? 0, 0)} 件${v.isBundle ? "（可組數量）" : ""}`],
                  ["填充重量", v.fillWeightG ? `${fmtNum(v.fillWeightG, 2)} g` : "—"],
                  ["包材 BOM", v.materials.map((m) => `${m.material.name} × ${fmtNum(m.quantityPerUnit, 2)}`).join("、") || "—"],
                  ...(v.isBundle ? [["組件", v.bundleComponents.map((c) => `${c.componentVariant.sku} × ${c.quantity}`).join("、")] as [string, string]] : []),
                ]}
              />
              {!v.isBundle && v.inventoryItem && (
                <SimpleTable
                  head={["成品批次", "在庫", "保留", "每件成本", "有效日期", "狀態"]}
                  rows={v.inventoryItem.lots.map((l) => [<A key="l" href={`/inventory/lots/${l.id}`}>{l.lotCode}</A>, fmtNum(l.onHand, 0), fmtNum(l.reserved, 0), fmtMoney2(l.unitCost), fmtDbDate(l.expiryDate), l.status === "AVAILABLE" ? "可用" : l.status === "QUARANTINE" ? "待檢" : "保留"])}
                  empty="目前無成品批次"
                />
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
