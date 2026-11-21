import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { fmtNum } from "@/lib/decimal";
import { fmtDateTime } from "@/lib/time";
import { Chart } from "@/components/chart";
import { A, Badge, Card, CardBody, CardHeader, KV, LinkButton, PageHeader, SimpleTable } from "@/components/ui";

export default async function CuppingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await prisma.cuppingSession.findUnique({
    where: { id },
    include: { scores: true, template: true, tags: { include: { flavorTag: true } }, roastBatch: { include: { greenLot: { include: { coffee: true } } } } },
  });
  if (!s) notFound();
  const siblings = await prisma.cuppingSession.findMany({ where: { roastBatchId: s.roastBatchId }, orderBy: { cuppedAt: "asc" }, include: { scores: true } });
  const attrs = s.template.attributes as Array<{ key: string; label: string }>;
  const radar = {
    tooltip: { trigger: "item" },
    radar: { indicator: attrs.map((a) => ({ name: a.label, max: Number(s.template.scaleMax), min: Number(s.template.scaleMin) })), radius: "65%" },
    series: [{ type: "radar", data: siblings.map((x) => ({ name: `烘後 ${x.restDays} 天${x.id === s.id ? "（本次）" : ""}`, value: attrs.map((a) => Number(x.scores.find((sc) => sc.attributeKey === a.key)?.score ?? 0)) })) }],
  };
  return (
    <>
      <PageHeader
        title={`杯測｜${s.roastBatch.greenLot.coffee.nameZh}`}
        description={`${fmtDateTime(s.cuppedAt)} · 烘後第 ${s.restDays} 天 · ${s.template.name}`}
        back={{ href: "/cupping", label: "杯測實驗室" }}
        actions={<><LinkButton href={`/cupping/compare?ids=${siblings.map((x) => x.id).join(",")}`} variant="outline">同批次比較</LinkButton><LinkButton href={`/cupping/new?roast=${s.roastBatchId}`}>＋ 再杯測一次</LinkButton></>}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="風味雷達圖" description={`同一烘焙批次所有杯測（${siblings.length} 次）；${s.template.scaleMin}–${s.template.scaleMax} 分`} />
          <CardBody>
            <Chart option={radar} height={340} ariaLabel="杯測風味雷達圖" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="評分" description="自訂評分模板，非 SCA 官方標準" />
          <SimpleTable head={["項目", "分數"]} rows={[...attrs.map((a) => [a.label, fmtNum(s.scores.find((x) => x.attributeKey === a.key)?.score, 2)]), [<b key="t">平均</b>, <b key="v">{fmtNum(s.totalScore, 2)}</b>]]} />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="杯測紀錄" />
          <CardBody>
            <KV
              cols={4}
              items={[
                ["烘焙批次", <A key="r" href={`/roasting/${s.roastBatchId}`}>{s.roastBatch.batchNo}</A>],
                ["研磨度", s.grindSetting],
                ["粉量／水量", `${fmtNum(s.doseG, 2)} g／${fmtNum(s.waterG, 1)} g`],
                ["水溫", s.waterTempC ? `${s.waterTempC}°C` : "—"],
                ["風味標籤", s.tags.length ? <span key="t" className="flex flex-wrap gap-1">{s.tags.map((t) => <Badge key={t.flavorTagId} tone="primary">{t.flavorTag.name}</Badge>)}</span> : "—"],
                ["瑕疵", s.defects],
                ["評分者", s.evaluator],
                ["熟豆耗用", s.consumedG ? `${fmtNum(s.consumedG, 1)} g` : "—"],
                ["描述", s.description],
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
