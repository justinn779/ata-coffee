import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { fmtNum } from "@/lib/decimal";
import { fmtDateTime, fmtSec } from "@/lib/time";
import { ActionDialog } from "@/components/action-dialog";
import { A, Badge, Card, CardBody, CardHeader, KV, LinkButton, PageHeader, SimpleTable } from "@/components/ui";
import { saveAsRecipe, toggleRecommended } from "../actions";

export default async function BrewDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await prisma.brewSession.findUnique({
    where: { id },
    include: { pourSteps: { orderBy: { stepNo: "asc" } }, roastBatch: { include: { greenLot: { include: { coffee: true } } } }, grinder: true, dripper: true, filter: true, recipe: true, tags: { include: { flavorTag: true } } },
  });
  if (!b) notFound();
  const same = await prisma.brewSession.findMany({ where: { roastBatch: { greenLot: { coffeeId: b.roastBatch.greenLot.coffeeId } } }, orderBy: { brewedAt: "desc" }, take: 6, select: { id: true } });
  return (
    <>
      <PageHeader
        title={`手沖｜${b.roastBatch.greenLot.coffee.nameZh}`}
        description={`${fmtDateTime(b.brewedAt)} · 烘後第 ${b.restDays} 天 · ${b.roastBatch.batchNo}`}
        back={{ href: "/brewing", label: "手沖實驗室" }}
        actions={
          <>
            <LinkButton href={`/brewing/new?copy=${b.id}`} variant="secondary">
              複製參數
            </LinkButton>
            <ActionDialog label="存為配方" variant="outline" title="儲存為配方" description="同名配方將建立新版本，舊版本保留。" payload={{ brewId: b.id }} fields={[{ name: "name", label: "配方名稱", required: true, defaultValue: b.recipe?.name ?? `${b.roastBatch.greenLot.coffee.nameZh} 手沖` }]} action={saveAsRecipe} />
            <ActionDialog label={b.isRecommended ? "取消推薦" : "標記推薦"} variant="ghost" title={b.isRecommended ? "取消推薦？" : "標記為推薦沖煮？"} payload={{ id: b.id }} action={toggleRecommended} />
            <LinkButton href={`/brewing/compare?ids=${same.map((x) => x.id).join(",")}`} variant="outline">
              同豆比較
            </LinkButton>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="沖煮參數" action={b.isRecommended ? <Badge tone="sage">推薦</Badge> : null} />
          <CardBody>
            <KV
              cols={3}
              items={[
                ["烘焙批次", <A key="r" href={`/roasting/${b.roastBatchId}`}>{b.roastBatch.batchNo}</A>],
                ["配方", b.recipe ? `${b.recipe.name} v${b.recipe.version}` : "—"],
                ["研磨機／刻度", `${b.grinder?.name ?? "—"}／${b.grindSetting ?? "—"}`],
                ["濾杯／濾紙", `${b.dripper?.name ?? "—"}／${b.filter?.name ?? "—"}`],
                ["粉量／總水量", `${fmtNum(b.doseG, 1)} g／${fmtNum(b.waterG, 0)} g`],
                ["粉水比", `1 : ${fmtNum(b.ratio, 2)}`],
                ["水溫", b.waterTempC ? `${b.waterTempC}°C` : "—"],
                ["水質", b.waterQuality],
                ["悶蒸", `${fmtNum(b.bloomWaterG, 0)} g／${fmtSec(b.bloomTimeSec)}`],
                ["總沖煮時間", fmtSec(b.totalTimeSec)],
                ["注水方式", b.pourMethod],
                ["流速", b.flowRateGPerSec ? `${b.flowRateGPerSec} g/s` : "—"],
                ["攪拌", b.agitation],
                ["TDS", b.tdsPercent ? `${b.tdsPercent}%` : "—"],
                ["萃取率", b.extractionPercent ? `${b.extractionPercent}%` : "—"],
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="結果" />
          <CardBody>
            <KV cols={2} items={[["評價", fmtNum(b.rating, 1)], ["風味標籤", b.tags.map((t) => t.flavorTag.name).join("、") || "—"], ["風味表現", b.flavorNotes], ["備註", b.note]]} />
          </CardBody>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader title="分段注水" />
          <SimpleTable head={["段", "起始", "結束", "注水量", "累積水量", "備註"]} rows={b.pourSteps.map((p) => [p.stepNo, fmtSec(p.startSec), fmtSec(p.endSec), `${fmtNum(p.waterG, 0)} g`, `${fmtNum(p.cumulativeG, 0)} g`, p.note ?? "—"])} empty="未紀錄分段" />
        </Card>
      </div>
    </>
  );
}
