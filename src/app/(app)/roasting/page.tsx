"use client";

import { fmtGrams, fmtPct } from "@/lib/decimal";
import { fmtDateTime, fmtSec } from "@/lib/time";
import { useCol } from "@/lib/data";
import { Guard } from "@/lib/page";
import { DataTable } from "@/components/data-table";
import { LinkButton, PageHeader } from "@/components/ui";

export default function RoastingPage() {
  const b = useCol("roastBatches", [], "roastedAt");
  const roasters = useCol("roasters");
  const curves = useCol("roastCurves");
  const last = b.data[0];
  return (
    <>
      <PageHeader
        title="烘焙中心"
        description="烘焙批次、時間事件與曲線；依豆款、日期、烘豆機篩選"
        actions={
          <>
            <LinkButton href="/roasting/compare/" variant="outline">
              曲線比較
            </LinkButton>
            {last && (
              <LinkButton href={`/roasting/new/?copy=${last.id}`} variant="secondary">
                複製上一批
              </LinkButton>
            )}
            <LinkButton href="/roasting/new/">＋ 開始新一批</LinkButton>
          </>
        }
      />
      <Guard loading={b.loading} error={b.error}>
        {() => (
          <DataTable
            columns={[
              { key: "no", label: "批次", sortable: true },
              { key: "coffee", label: "咖啡豆" },
              { key: "date", label: "烘焙時間", sortable: true },
              { key: "in", label: "投入", align: "right", hideOnMobile: true },
              { key: "out", label: "產出", align: "right", hideOnMobile: true },
              { key: "loss", label: "失重率", align: "right", sortable: true },
              { key: "time", label: "總時間", align: "right", sortable: true },
              { key: "dtr", label: "DTR", align: "right", sortable: true },
              { key: "level", label: "程度", hideOnMobile: true },
              { key: "curve", label: "曲線", hideOnMobile: true },
            ]}
            filters={[
              { key: "coffee", label: "豆款", options: [...new Map(b.data.map((x) => [x.coffeeId, x.coffeeName])).entries()].map(([value, label]) => ({ value, label })) },
              { key: "roaster", label: "烘豆機", options: roasters.data.map((r) => ({ value: r.id, label: r.name })) },
              { key: "month", label: "月份", options: [...new Set(b.data.map((x) => fmtDateTime(x.roastedAt).slice(0, 7)))].map((m) => ({ value: m, label: m })) },
            ]}
            rows={b.data.map((x) => ({
              id: x.id,
              href: `/roasting/view/?id=${x.id}`,
              search: [x.batchNo, x.coffeeName, x.greenLotCode, x.roastLevel, x.roasterName, x.note].join(" "),
              filters: { coffee: x.coffeeId, roaster: x.roasterId, month: fmtDateTime(x.roastedAt).slice(0, 7) },
              sort: { no: x.batchNo, date: x.roastedAt, loss: Number(x.weightLossPercent), time: x.totalTimeSec, dtr: x.dtrPercent == null ? null : Number(x.dtrPercent) },
              cells: {
                no: x.batchNo,
                coffee: x.coffeeName,
                date: fmtDateTime(x.roastedAt),
                in: fmtGrams(x.greenWeightG),
                out: fmtGrams(x.roastedWeightG),
                loss: fmtPct(x.weightLossPercent),
                time: fmtSec(x.totalTimeSec),
                dtr: fmtPct(x.dtrPercent),
                level: x.roastLevel ?? "—",
                curve: curves.data.filter((c) => c.roastBatchId === x.id).length ? `${curves.data.filter((c) => c.roastBatchId === x.id).length} 條` : "—",
              },
            }))}
          />
        )}
      </Guard>
    </>
  );
}
