"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { fmtDateTime } from "@/lib/time";
import { opAction } from "@/lib/api";
import { basePath } from "@/lib/firebase";
import { useCol, useDocument } from "@/lib/data";
import { Guard, useQS } from "@/lib/page";
import { ActionDialog } from "@/components/action-dialog";
import { A, Badge, Card, CardHeader, PageHeader, SimpleTable } from "@/components/ui";
import { SeriesForm } from "../series-form";

function Qr({ url }: { url: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    QRCode.toString(url, { type: "svg", margin: 1, width: 96 }).then(setSvg);
  }, [url]);
  return <span className="block h-16 w-16 rounded bg-white p-0.5" role="img" aria-label="QR Code" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export default function SeriesDetail() {
  const id = useQS("id");
  const s = useDocument("brandSeries", id);
  const products = useCol("products", [["brandSeriesId", id]]);
  const traces = useCol("traces", [], "createdAt");
  const pids = new Set(products.data.map((p) => p.id));
  const mine = traces.data.filter((t) => pids.has(t.productId));
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <Guard loading={s.loading} error={s.error} missing={!s.data}>
      {() => (
        <>
          <PageHeader title={`${s.data!.code}｜${s.data!.name}`} back={{ href: "/series/", label: "品牌系列" }} />
          <div className="grid gap-6">
            <SeriesForm initial={s.data!} />
            <Card>
              <CardHeader title="對應商品" />
              <SimpleTable head={["商品", "分類"]} rows={products.data.map((p) => [<A key="p" href={`/products/view/?id=${p.id}`}>{p.name}</A>, p.code])} empty="尚無商品；請於商品頁指定品牌系列" />
            </Card>
            <Card>
              <CardHeader title="QR Code 商品履歷" description="每個包裝批次一個公開代碼；公開頁只顯示咖啡豆介紹、產區處理法、烘焙日期、風味、推薦沖煮與批次編號，不含成本、研發備註或顧客資料" />
              <SimpleTable
                head={["QR", "包裝批次", "品項編號", "建立時間", "狀態", ""]}
                rows={mine.map((t) => {
                  const url = `${origin}${basePath}/t/?c=${t.publicCode}`;
                  return [
                    <Qr key="q" url={url} />,
                    t.batchNo,
                    t.sku,
                    fmtDateTime(t.createdAt),
                    t.isPublished ? <a key="l" className="text-primary hover:underline" href={url}>已發布</a> : <Badge key="b">未發布</Badge>,
                    <ActionDialog key="a" label={t.isPublished ? "取消發布" : "發布"} size="sm" variant="ghost" title={t.isPublished ? "取消發布履歷？" : "發布公開履歷？"} payload={{ id: t.id, publish: !t.isPublished }} fields={t.isPublished ? [] : [{ name: "recommendedBrew", label: "推薦沖煮方式（選填，覆寫系列配方）", defaultValue: t.recommendedBrew ?? "" }]} action={opAction("trace.setPublished")} />,
                  ];
                })}
                empty="此系列商品尚無包裝批次"
              />
            </Card>
          </div>
        </>
      )}
    </Guard>
  );
}
