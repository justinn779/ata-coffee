import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { fmtGrams, fmtMoney2, fmtPct, fmtNum } from "@/lib/decimal";
import { fmtDate, fmtDbDate } from "@/lib/time";
import { ActionDialog } from "@/components/action-dialog";
import { A, Card, CardBody, CardHeader, KV, LinkButton, PageHeader, SimpleTable } from "@/components/ui";
import { archiveCoffee } from "../actions";

export default async function CoffeeDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.coffee.findUnique({
    where: { id },
    include: {
      supplier: true,
      greenLots: { orderBy: { receivedAt: "desc" }, include: { inventoryLot: true, purchase: true, _count: { select: { roastBatches: true } } } },
      products: { include: { variants: true } },
    },
  });
  if (!c) notFound();
  const roasts = await prisma.roastBatch.findMany({ where: { greenLot: { coffeeId: id } }, orderBy: { roastedAt: "desc" }, take: 20 });
  return (
    <>
      <PageHeader
        title={c.nameZh}
        description={[c.nameEn, c.code].filter(Boolean).join("・")}
        back={{ href: "/coffees", label: "咖啡豆資料" }}
        actions={
          <>
            <LinkButton href={`/green/new?coffee=${c.id}`}>＋ 生豆採購</LinkButton>
            <LinkButton href={`/coffees/${c.id}/edit`} variant="outline">
              編輯
            </LinkButton>
            <ActionDialog label={c.archivedAt ? "取消封存" : "封存"} variant="ghost" title={c.archivedAt ? "取消封存？" : "封存此咖啡豆？"} description="封存後不會出現在新增表單選項中，歷史資料保留。" payload={{ id: c.id }} action={archiveCoffee} />
          </>
        }
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader title="基本資料" />
          <CardBody>
            <KV
              cols={4}
              items={[
                ["產國", c.country],
                ["產區", c.region],
                ["莊園", c.farm],
                ["生產者", c.producer],
                ["品種", c.variety],
                ["處理法", c.process],
                ["海拔", c.altitude],
                ["生豆等級", c.grade],
                ["供應商", c.supplier?.name],
                ["品牌商品名稱", c.brandName],
                ["原始風味", c.originFlavorNotes],
                ["備註", c.note],
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="養豆與賞味預設" description="烘焙批次可覆寫；最佳風味區間 ≠ 商品標示有效日期" />
          <CardBody>
            <KV
              cols={4}
              items={[
                ["建議養豆開始", c.restStartDays != null ? `烘後 ${c.restStartDays} 天` : "未設定"],
                ["最佳風味觀察區間", c.peakFromDays != null ? `烘後 ${c.peakFromDays}–${c.peakToDays ?? "?"} 天` : "未設定"],
                ["預設保存期限", c.shelfLifeDays != null ? `${c.shelfLifeDays} 天` : "未設定"],
                ["備註", c.freshnessNote],
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="生豆採購批次" action={<A href={`/green/new?coffee=${c.id}`}>＋ 新增</A>} />
          <SimpleTable
            head={["批次", "採購日", "入庫量", "剩餘", "每克成本", "含水率", "烘焙次數"]}
            rows={c.greenLots.map((g) => [
              g.inventoryLot ? <A key="l" href={`/inventory/lots/${g.inventoryLot.id}`}>{g.lotCode}</A> : g.lotCode,
              fmtDbDate(g.purchase.purchaseDate),
              fmtGrams(g.receivedWeightG),
              fmtGrams(g.inventoryLot?.onHand),
              fmtMoney2(g.costPerG),
              fmtPct(g.moisturePercent),
              g._count.roastBatches,
            ])}
            empty="尚無採購批次"
          />
        </Card>
        <Card>
          <CardHeader title="烘焙紀錄" action={<A href={`/roasting?coffee=${c.id}`}>全部</A>} />
          <SimpleTable
            head={["批次", "日期", "投入", "產出", "失重率", "DTR", "程度"]}
            rows={roasts.map((r) => [<A key="r" href={`/roasting/${r.id}`}>{r.batchNo}</A>, fmtDate(r.roastedAt), fmtGrams(r.greenWeightG), fmtGrams(r.roastedWeightG), fmtPct(r.weightLossPercent), fmtPct(r.dtrPercent), r.roastLevel ?? "—"])}
            empty="尚無烘焙紀錄"
          />
        </Card>
        <Card>
          <CardHeader title="對應商品" />
          <SimpleTable
            head={["商品", "SKU", "售價", "填充重量"]}
            rows={c.products.flatMap((p) => p.variants.map((v) => [<A key="p" href={`/products/${p.id}`}>{p.name}</A>, v.sku, fmtMoney2(v.salePrice), v.fillWeightG ? `${fmtNum(v.fillWeightG, 1)} g` : "—"]))}
            empty="尚無對應商品"
          />
        </Card>
      </div>
    </>
  );
}
