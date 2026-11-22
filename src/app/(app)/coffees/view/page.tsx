"use client";

import { fmtGrams, fmtMoney2, fmtNum, fmtPct } from "@/lib/decimal";
import { fmtDate, fmtDbDate } from "@/lib/time";
import { opAction } from "@/lib/api";
import { useCol, useDocument } from "@/lib/data";
import { Guard, useQS } from "@/lib/page";
import { ActionDialog } from "@/components/action-dialog";
import { A, Card, CardBody, CardHeader, KV, LinkButton, PageHeader, SimpleTable } from "@/components/ui";

export default function CoffeeDetail() {
  const id = useQS("id");
  const c = useDocument("coffees", id);
  const greens = useCol("greenLots", [["coffeeId", id]], "receivedAt");
  const lots = useCol("invLots", [["coffeeId", id]]);
  const roasts = useCol("roastBatches", [["coffeeId", id]], "roastedAt");
  const variants = useCol("variants", [["coffeeId", id]], "sku", false);
  const lotOf = (gid: string) => lots.data.find((l) => l.greenLotId === gid);
  return (
    <Guard loading={c.loading} error={c.error} missing={!c.data}>
      {() => {
        const x = c.data!;
        return (
          <>
            <PageHeader
              title={x.nameZh}
              description={[x.nameEn, x.code].filter(Boolean).join("・")}
              back={{ href: "/coffees/", label: "咖啡豆資料" }}
              actions={
                <>
                  <LinkButton href={`/green/new/?coffee=${x.id}`}>＋ 生豆採購</LinkButton>
                  <LinkButton href={`/coffees/edit/?id=${x.id}`} variant="outline">
                    編輯
                  </LinkButton>
                  <ActionDialog label={x.archivedAt ? "取消封存" : "封存"} variant="ghost" title={x.archivedAt ? "取消封存？" : "封存此咖啡豆？"} description="封存後不會出現在新增表單選項中，歷史資料保留。" payload={{ id: x.id }} action={opAction("coffee.archive")} />
                </>
              }
            />
            <div className="grid gap-6">
              <Card>
                <CardHeader title="基本資料" />
                <CardBody>
                  <KV cols={4} items={[["產國", x.country], ["產區", x.region], ["莊園", x.farm], ["生產者", x.producer], ["品種", x.variety], ["處理法", x.process], ["海拔", x.altitude], ["生豆等級", x.grade], ["供應商", x.supplierName], ["品牌商品名稱", x.brandName], ["原始風味", x.originFlavorNotes], ["備註", x.note]]} />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="養豆與賞味預設" description="烘焙批次可覆寫；最佳風味區間 ≠ 商品標示有效日期" />
                <CardBody>
                  <KV cols={4} items={[["建議養豆開始", x.restStartDays != null ? `烘後 ${x.restStartDays} 天` : "未設定"], ["最佳風味觀察區間", x.peakFromDays != null ? `烘後 ${x.peakFromDays}–${x.peakToDays ?? "?"} 天` : "未設定"], ["預設保存期限", x.shelfLifeDays != null ? `${x.shelfLifeDays} 天` : "未設定"], ["備註", x.freshnessNote]]} />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="生豆採購批次" action={<A href={`/green/new/?coffee=${x.id}`}>＋ 新增</A>} />
                <SimpleTable head={["批次", "採購日", "入庫量", "剩餘", "每克成本", "含水率"]} rows={greens.data.map((g) => [<A key="l" href={`/inventory/lot/?id=${g.invLotId}`}>{g.lotCode}</A>, fmtDbDate(g.purchaseDate), fmtGrams(g.receivedWeightG), fmtGrams(lotOf(g.id)?.onHand), fmtMoney2(g.costPerG), fmtPct(g.moisturePercent)])} empty="尚無採購批次" />
              </Card>
              <Card>
                <CardHeader title="烘焙紀錄" action={<A href="/roasting/">全部</A>} />
                <SimpleTable head={["批次", "日期", "投入", "產出", "失重率", "DTR", "程度"]} rows={roasts.data.slice(0, 20).map((r) => [<A key="r" href={`/roasting/view/?id=${r.id}`}>{r.batchNo}</A>, fmtDate(r.roastedAt), fmtGrams(r.greenWeightG), fmtGrams(r.roastedWeightG), fmtPct(r.weightLossPercent), fmtPct(r.dtrPercent), r.roastLevel ?? "—"])} empty="尚無烘焙紀錄" />
              </Card>
              <Card>
                <CardHeader title="對應商品" />
                <SimpleTable head={["商品", "品項編號", "售價", "填充重量"]} rows={variants.data.map((v) => [<A key="p" href={`/products/view/?id=${v.productId}`}>{v.productName}</A>, v.sku, fmtMoney2(v.salePrice), v.fillWeightG ? `${fmtNum(v.fillWeightG, 1)} g` : "—"])} empty="尚無對應商品" />
              </Card>
            </div>
          </>
        );
      }}
    </Guard>
  );
}
