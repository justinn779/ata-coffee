import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/time";
import { ActionDialog } from "@/components/action-dialog";
import { A, Badge, Card, CardHeader, PageHeader, SimpleTable } from "@/components/ui";
import { toggleTracePublish } from "../actions";
import { SeriesForm } from "../series-form";

export default async function SeriesDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await prisma.brandSeries.findUnique({ where: { id }, include: { products: { include: { variants: true } } } });
  if (!s) notFound();
  const traces = await prisma.productTraceability.findMany({
    where: { packagingBatch: { productionOrder: { targetVariant: { product: { brandSeriesId: id } } } } },
    include: { packagingBatch: { include: { productionOrder: { include: { targetVariant: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  const h = await headers();
  const origin = process.env.PUBLIC_BASE_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const qrs = await Promise.all(traces.map((t) => QRCode.toString(`${origin}/t/${t.publicCode}`, { type: "svg", margin: 1, width: 96 })));
  return (
    <>
      <PageHeader title={`${s.code}｜${s.name}`} back={{ href: "/series", label: "品牌系列" }} />
      <div className="grid gap-6">
        <SeriesForm initial={s} />
        <Card>
          <CardHeader title="對應商品" />
          <SimpleTable head={["商品", "SKU"]} rows={s.products.map((p) => [<A key="p" href={`/products/${p.id}`}>{p.name}</A>, p.variants.map((v) => v.sku).join("、")])} empty="尚無商品；請於商品頁指定品牌系列" />
        </Card>
        <Card>
          <CardHeader title="QR Code 商品履歷" description="每個包裝批次一個公開代碼；公開頁只顯示咖啡豆介紹、產區處理法、烘焙日期、風味、推薦沖煮與批次編號，不含成本、研發備註或顧客資料" />
          <SimpleTable
            head={["QR", "包裝批次", "SKU", "包裝時間", "狀態", ""]}
            rows={traces.map((t, i) => [
              <span key="q" className="block h-16 w-16 rounded bg-white p-0.5" dangerouslySetInnerHTML={{ __html: qrs[i] }} aria-label={`批次 ${t.packagingBatch.batchNo} 的 QR Code`} />,
              t.packagingBatch.batchNo,
              t.packagingBatch.productionOrder.targetVariant.sku,
              fmtDateTime(t.packagingBatch.packagedAt),
              t.isPublished ? <A key="l" href={`/t/${t.publicCode}`}>已發布 /t/{t.publicCode}</A> : <Badge key="b">未發布</Badge>,
              <ActionDialog key="a" label={t.isPublished ? "取消發布" : "發布"} size="sm" variant="ghost" title={t.isPublished ? "取消發布履歷？" : "發布公開履歷？"} payload={{ id: t.id }} fields={t.isPublished ? [] : [{ name: "recommendedBrew", label: "推薦沖煮方式（選填，覆寫系列配方）", defaultValue: t.recommendedBrew ?? "" }]} action={toggleTracePublish} />,
            ])}
            empty="此系列商品尚無包裝批次"
          />
        </Card>
      </div>
    </>
  );
}
