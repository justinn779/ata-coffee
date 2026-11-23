"use client";

import { D, fmtMoney, fmtMoney2, fmtNum } from "@/lib/decimal";
import { fmtDbDate } from "@/lib/time";
import { PRODUCT_CATEGORY, PRODUCT_STATUS, STOCK_POLICY } from "@/lib/labels";
import { useCol, useDocument, type Row } from "@/lib/data";
import { Guard, useQS } from "@/lib/page";
import { StatusBadge } from "@/components/status";
import { DeleteButton } from "@/components/delete-button";
import { A, Badge, Card, CardBody, CardHeader, KV, LinkButton, PageHeader, SimpleTable } from "@/components/ui";
import { useAvailability } from "../shared";

export default function ProductDetail() {
  const id = useQS("id");
  const p = useDocument("products", id);
  const variants = useCol("variants", [["productId", id]], "sku", false);
  const lots = useCol("invLots", [["kind", "FINISHED"]], "createdAt");
  const series = useDocument("brandSeries", p.data?.brandSeriesId);
  const coffee = useDocument("coffees", p.data?.coffeeId);
  const avail = useAvailability();
  return (
    <Guard loading={p.loading} error={p.error} missing={!p.data}>
      {() => {
        const x = p.data!;
        return (
          <>
            <PageHeader
              title={x.name}
              description={`${x.code} · ${PRODUCT_CATEGORY[x.category]}`}
              back={{ href: "/products/", label: "商品與品項" }}
              actions={
                <>
                  <LinkButton href={`/products/variant/?product=${x.id}`}>＋ 新增品項</LinkButton>
                  <LinkButton href={`/products/edit/?id=${x.id}`} variant="outline">
                    編輯商品
                  </LinkButton>
                  <DeleteButton inline={false} what="商品" name={x.name} col="products" id={x.id} redirectTo="/products/" description="需先刪除底下所有品項。已有訂單或分裝紀錄的品項不能刪除，可改為「停售／封存」狀態。" />
                </>
              }
            />
            <div className="grid gap-6">
              <Card>
                <CardHeader title="商品資料" action={<StatusBadge map={PRODUCT_STATUS} value={x.status} />} />
                <CardBody>
                  <KV
                    cols={4}
                    items={[
                      ["品牌系列", series.data ? <A key="s" href={`/series/view/?id=${series.data.id}`}>{series.data.code} {series.data.name}</A> : "—"],
                      ["對應咖啡豆", coffee.data ? <A key="c" href={`/coffees/view/?id=${coffee.data.id}`}>{coffee.data.nameZh}</A> : "—"],
                      ["限定商品", x.isLimited ? "是" : "否"],
                      ["販售期間", x.saleStartDate || x.saleEndDate ? `${fmtDbDate(x.saleStartDate)} ～ ${fmtDbDate(x.saleEndDate)}` : "不限"],
                      ["風味說明", x.flavorNotes],
                      ["商品介紹", x.description],
                    ]}
                  />
                </CardBody>
              </Card>
              {variants.data.map((v) => (
                <Card key={v.id}>
                  <CardHeader title={<span>{v.sku}｜{v.name} {v.isBundle && <Badge tone="info">套組</Badge>}</span>} description={STOCK_POLICY[v.stockPolicy]} action={<span className="flex items-center gap-1"><A href={`/products/variant/?product=${x.id}&id=${v.id}`}>編輯</A><DeleteButton what="品項" name={v.sku} col="variants" id={v.id} description="已有訂單、分裝或庫存的品項不能刪除。" /></span>} />
                  <CardBody className="space-y-4">
                    <KV
                      cols={4}
                      items={[
                        ["原價／售價", `${fmtMoney(v.listPrice)}／${fmtMoney(v.salePrice)}`],
                        ["估計成本", fmtMoney2(v.standardCost)],
                        ["估計毛利", v.standardCost ? `${fmtMoney(D(v.salePrice).sub(v.standardCost))}（${fmtNum(D(v.salePrice).sub(v.standardCost).div(v.salePrice).mul(100), 1)}%）` : "—"],
                        ["可售", v.stockPolicy === "NOT_TRACKED" ? "不追蹤" : `${fmtNum(avail.get(v.id) ?? 0, 0)} 件${v.isBundle ? "（可組數量）" : ""}`],
                        ["填充重量", v.fillWeightG ? `${fmtNum(v.fillWeightG, 2)} g` : "—"],
                        ["包材 BOM", ((v.materials as Row[]) ?? []).map((m) => `${m.materialName} × ${fmtNum(m.quantityPerUnit, 2)}`).join("、") || "—"],
                        ...(v.isBundle ? [["組件", ((v.bundleComponents as Row[]) ?? []).map((c) => `${c.sku} × ${c.quantity}`).join("、")] as [string, string]] : []),
                      ]}
                    />
                    {!v.isBundle && (
                      <SimpleTable
                        head={["成品批次", "在庫", "保留", "每件成本", "有效日期", "狀態"]}
                        rows={lots.data.filter((l) => l.variantId === v.id && D(l.onHand).gt(0)).map((l) => [<A key="l" href={`/inventory/lot/?id=${l.id}`}>{l.lotCode}</A>, fmtNum(l.onHand, 0), fmtNum(l.reserved, 0), fmtMoney2(l.unitCost), fmtDbDate(l.expiryDate), l.status === "AVAILABLE" ? "可用" : l.status === "QUARANTINE" ? "待檢" : "保留"])}
                        empty="目前無成品批次"
                      />
                    )}
                  </CardBody>
                </Card>
              ))}
            </div>
          </>
        );
      }}
    </Guard>
  );
}
