import { prisma } from "@/lib/db";
import { fmtGrams, fmtPct } from "@/lib/decimal";
import { fmtDateTime, fmtSec } from "@/lib/time";
import { DataTable } from "@/components/data-table";
import { LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "烘焙中心" };

export default async function RoastingPage() {
  const [batches, roasters] = await Promise.all([
    prisma.roastBatch.findMany({
      orderBy: { roastedAt: "desc" },
      include: { greenLot: { include: { coffee: true } }, roaster: true, _count: { select: { curves: true, cuppingSessions: true } } },
    }),
    prisma.roasterProfile.findMany(),
  ]);
  const last = batches[0];
  return (
    <>
      <PageHeader
        title="烘焙中心"
        description="烘焙批次、時間事件與曲線；依豆款、日期、烘豆機篩選，勾選多批可疊圖比較"
        actions={
          <>
            <LinkButton href="/roasting/compare" variant="outline">
              曲線比較
            </LinkButton>
            {last && (
              <LinkButton href={`/roasting/new?copy=${last.id}`} variant="secondary">
                複製上一批
              </LinkButton>
            )}
            <LinkButton href="/roasting/new">＋ 開始新一批</LinkButton>
          </>
        }
      />
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
          { key: "coffee", label: "豆款", options: [...new Map(batches.map((b) => [b.greenLot.coffeeId, b.greenLot.coffee.nameZh])).entries()].map(([value, label]) => ({ value, label })) },
          { key: "roaster", label: "烘豆機", options: roasters.map((r) => ({ value: r.id, label: r.name })) },
          { key: "month", label: "月份", options: [...new Set(batches.map((b) => fmtDateTime(b.roastedAt).slice(0, 7)))].map((m) => ({ value: m, label: m })) },
        ]}
        rows={batches.map((b) => ({
          id: b.id,
          href: `/roasting/${b.id}`,
          search: [b.batchNo, b.greenLot.coffee.nameZh, b.greenLot.lotCode, b.roastLevel, b.roaster.name, b.note].join(" "),
          filters: { coffee: b.greenLot.coffeeId, roaster: b.roasterId, month: fmtDateTime(b.roastedAt).slice(0, 7) },
          sort: { no: b.batchNo, date: b.roastedAt.getTime(), loss: Number(b.weightLossPercent), time: b.totalTimeSec, dtr: b.dtrPercent == null ? null : Number(b.dtrPercent) },
          cells: {
            no: b.batchNo,
            coffee: b.greenLot.coffee.nameZh,
            date: fmtDateTime(b.roastedAt),
            in: fmtGrams(b.greenWeightG),
            out: fmtGrams(b.roastedWeightG),
            loss: fmtPct(b.weightLossPercent),
            time: fmtSec(b.totalTimeSec),
            dtr: fmtPct(b.dtrPercent),
            level: b.roastLevel ?? "—",
            curve: b._count.curves ? `${b._count.curves} 條` : "—",
          },
        }))}
      />
    </>
  );
}
