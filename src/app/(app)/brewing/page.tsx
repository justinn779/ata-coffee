"use client";

import { fmtNum } from "@/lib/decimal";
import { fmtDate, fmtSec } from "@/lib/time";
import { useCol } from "@/lib/data";
import { Guard } from "@/lib/page";
import { DataTable } from "@/components/data-table";
import { Badge, LinkButton, PageHeader, Tabs } from "@/components/ui";

export default function BrewingPage() {
  const s = useCol("brewSessions", [], "brewedAt");
  return (
    <>
      <PageHeader title="手沖" description="每次沖煮對應烘焙批次；可複製參數、儲存配方版本與比較" actions={<><LinkButton href="/brewing/compare/" variant="outline">比較</LinkButton><LinkButton href="/brewing/new/">＋ 新增手沖</LinkButton></>} />
      <Tabs active="sessions" tabs={[{ key: "sessions", label: "沖煮紀錄", href: "/brewing/", count: s.data.length }, { key: "recipes", label: "配方", href: "/brewing/recipes/" }]} />
      <Guard loading={s.loading} error={s.error}>
        {() => (
          <DataTable
            columns={[
              { key: "date", label: "日期", sortable: true },
              { key: "coffee", label: "咖啡豆" },
              { key: "rest", label: "烘後", align: "right", sortable: true },
              { key: "ratio", label: "粉水比", align: "right" },
              { key: "temp", label: "水溫", align: "right", hideOnMobile: true },
              { key: "time", label: "總時間", align: "right", hideOnMobile: true },
              { key: "eq", label: "器材", hideOnMobile: true },
              { key: "rating", label: "評價", align: "right", sortable: true },
            ]}
            filters={[
              { key: "coffee", label: "豆款", options: [...new Map(s.data.map((x) => [x.coffeeId, x.coffeeName])).entries()].map(([value, label]) => ({ value, label })) },
              { key: "rec", label: "推薦", options: [{ value: "1", label: "僅推薦" }] },
            ]}
            rows={s.data.map((x) => ({
              id: x.id,
              href: `/brewing/view/?id=${x.id}`,
              search: [x.batchNo, x.coffeeName, x.flavorNotes, x.note, x.pourMethod, x.recipeLabel].join(" "),
              filters: { coffee: x.coffeeId, rec: x.isRecommended ? "1" : "" },
              sort: { date: x.brewedAt, rest: x.restDays, rating: x.rating == null ? null : Number(x.rating) },
              cells: {
                date: fmtDate(x.brewedAt),
                coffee: <span>{x.coffeeName} {x.isRecommended && <Badge tone="sage">推薦</Badge>}</span>,
                rest: x.restDays == null ? "—" : `${x.restDays} 天`,
                ratio: `${fmtNum(x.doseG, 1)}g · 1:${fmtNum(x.ratio, 1)}`,
                temp: x.waterTempC ? `${x.waterTempC}°C` : "—",
                time: fmtSec(x.totalTimeSec),
                eq: [x.grinderName, x.dripperName].filter(Boolean).join(" / ") || "—",
                rating: fmtNum(x.rating, 1),
              },
            }))}
          />
        )}
      </Guard>
    </>
  );
}
