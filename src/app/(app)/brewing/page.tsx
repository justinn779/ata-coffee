import { prisma } from "@/lib/db";
import { fmtNum } from "@/lib/decimal";
import { fmtDate, fmtSec } from "@/lib/time";
import { DataTable } from "@/components/data-table";
import { Badge, LinkButton, PageHeader, Tabs } from "@/components/ui";

export const metadata = { title: "手沖實驗室" };

export default async function BrewingPage() {
  const sessions = await prisma.brewSession.findMany({
    orderBy: { brewedAt: "desc" },
    include: { roastBatch: { include: { greenLot: { include: { coffee: true } } } }, dripper: true, grinder: true, recipe: true },
  });
  return (
    <>
      <PageHeader title="手沖實驗室" description="每次沖煮對應烘焙批次；可複製參數、儲存配方版本與比較" actions={<><LinkButton href="/brewing/compare" variant="outline">比較</LinkButton><LinkButton href="/brewing/new">＋ 新增手沖</LinkButton></>} />
      <Tabs active="sessions" tabs={[{ key: "sessions", label: "沖煮紀錄", href: "/brewing", count: sessions.length }, { key: "recipes", label: "配方", href: "/brewing/recipes" }]} />
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
          { key: "coffee", label: "豆款", options: [...new Map(sessions.map((s) => [s.roastBatch.greenLot.coffeeId, s.roastBatch.greenLot.coffee.nameZh])).entries()].map(([value, label]) => ({ value, label })) },
          { key: "rec", label: "推薦", options: [{ value: "1", label: "僅推薦" }] },
        ]}
        rows={sessions.map((s) => ({
          id: s.id,
          href: `/brewing/${s.id}`,
          search: [s.roastBatch.batchNo, s.roastBatch.greenLot.coffee.nameZh, s.flavorNotes, s.note, s.pourMethod, s.recipe?.name].join(" "),
          filters: { coffee: s.roastBatch.greenLot.coffeeId, rec: s.isRecommended ? "1" : "" },
          sort: { date: s.brewedAt.getTime(), rest: s.restDays, rating: s.rating == null ? null : Number(s.rating) },
          cells: {
            date: fmtDate(s.brewedAt),
            coffee: (
              <span>
                {s.roastBatch.greenLot.coffee.nameZh} {s.isRecommended && <Badge tone="sage">推薦</Badge>}
              </span>
            ),
            rest: `${s.restDays} 天`,
            ratio: `${fmtNum(s.doseG, 1)}g · 1:${fmtNum(s.ratio, 1)}`,
            temp: s.waterTempC ? `${s.waterTempC}°C` : "—",
            time: fmtSec(s.totalTimeSec),
            eq: [s.grinder?.name, s.dripper?.name].filter(Boolean).join(" / ") || "—",
            rating: fmtNum(s.rating, 1),
          },
        }))}
      />
    </>
  );
}
