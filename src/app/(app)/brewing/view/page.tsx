"use client";

import { fmtNum } from "@/lib/decimal";
import { fmtDateTime, fmtSec } from "@/lib/time";
import { opAction } from "@/lib/api";
import { useCol, useDocument, type Row } from "@/lib/data";
import { Guard, useQS } from "@/lib/page";
import { ActionDialog } from "@/components/action-dialog";
import { A, Badge, Card, CardBody, CardHeader, KV, LinkButton, PageHeader, SimpleTable } from "@/components/ui";

export default function BrewDetail() {
  const id = useQS("id");
  const b = useDocument("brewSessions", id);
  const same = useCol(b.data ? "brewSessions" : null, [["coffeeId", b.data?.coffeeId]], "brewedAt");
  return (
    <Guard loading={b.loading} error={b.error} missing={!b.data}>
      {() => {
        const x = b.data!;
        return (
          <>
            <PageHeader
              title={`手沖｜${x.coffeeName}`}
              description={`${fmtDateTime(x.brewedAt)}${x.restDays == null ? "" : ` · 烘後第 ${x.restDays} 天`} · ${x.batchNo}`}
              back={{ href: "/brewing/", label: "手沖" }}
              actions={
                <>
                  <LinkButton href={`/brewing/new/?copy=${x.id}`} variant="secondary">
                    複製參數
                  </LinkButton>
                  <ActionDialog label="存為配方" variant="outline" title="儲存為配方" description="同名配方將建立新版本，舊版本保留。" payload={{ brewId: x.id }} fields={[{ name: "name", label: "配方名稱", required: true, defaultValue: x.recipeLabel?.replace(/ v\d+$/, "") ?? `${x.coffeeName} 手沖` }]} action={opAction("recipe.saveFromBrew")} />
                  <ActionDialog label={x.isRecommended ? "取消推薦" : "標記推薦"} variant="ghost" title={x.isRecommended ? "取消推薦？" : "標記為推薦沖煮？"} payload={{ id: x.id }} action={opAction("brew.toggleRecommended")} />
                  <LinkButton href={`/brewing/new/?edit=${x.id}`} variant="secondary">
                    修改
                  </LinkButton>
                  <ActionDialog label="刪除" variant="danger" title="刪除這筆沖煮紀錄？" description="若此紀錄曾扣除熟豆庫存，將自動沖銷回庫存；由此紀錄建立的配方不受影響。刪除後無法復原（操作紀錄會保留）。" confirmLabel="確認刪除" payload={{ id: x.id }} action={opAction("brew.delete")} redirectTo="/brewing/" />
                  <LinkButton href={`/brewing/compare/?ids=${same.data.slice(0, 6).map((q) => q.id).join(",")}`} variant="outline">
                    同豆比較
                  </LinkButton>
                </>
              }
            />
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader title="沖煮參數" action={x.isRecommended ? <Badge tone="sage">推薦</Badge> : null} />
                <CardBody>
                  <KV
                    cols={3}
                    items={[
                      ["烘焙批次", x.roastBatchId ? <A key="r" href={`/roasting/view/?id=${x.roastBatchId}`}>{x.batchNo}</A> : `${x.roastDeleted ? `${x.batchNo}（烘焙紀錄已刪除）` : "樣品（沒有烘豆紀錄）"}${x.sampleRoastedDate ? `・烘焙日 ${x.sampleRoastedDate}` : ""}`],
                      ["配方", x.recipeLabel ?? "—"],
                      ["研磨機／刻度", `${x.grinderName ?? "—"}／${x.grindSetting ?? "—"}`],
                      ["濾杯／濾紙", `${x.dripperName ?? "—"}／${x.filterName ?? "—"}`],
                      ["粉量／總水量", `${fmtNum(x.doseG, 1)} g／${fmtNum(x.waterG, 0)} g`],
                      ["粉水比", `1 : ${fmtNum(x.ratio, 2)}`],
                      ["水溫", x.waterTempC ? `${x.waterTempC}°C` : "—"],
                      ["水質", x.waterQuality],
                      ["悶蒸", `${fmtNum(x.bloomWaterG, 0)} g／${fmtSec(x.bloomTimeSec)}`],
                      ["總沖煮時間", fmtSec(x.totalTimeSec)],
                      ["注水方式", x.pourMethod],
                      ["流速", x.flowRateGPerSec ? `${x.flowRateGPerSec} g/s` : "—"],
                      ["攪拌", x.agitation],
                      ["TDS", x.tdsPercent ? `${x.tdsPercent}%` : "—"],
                      ["萃取率", x.extractionPercent ? `${x.extractionPercent}%` : "—"],
                    ]}
                  />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="結果" />
                <CardBody>
                  <KV cols={2} items={[["評價", fmtNum(x.rating, 1)], ["風味標籤", (x.tags ?? []).join("、") || "—"], ["風味表現", x.flavorNotes], ["備註", x.note]]} />
                </CardBody>
              </Card>
              <Card className="lg:col-span-3">
                <CardHeader title="分段注水" />
                <SimpleTable head={["段", "起始", "結束", "注水量", "累積水量", "備註"]} rows={((x.pourSteps as Row[]) ?? []).map((p) => [p.stepNo, fmtSec(p.startSec), fmtSec(p.endSec), `${fmtNum(p.waterG, 0)} g`, `${fmtNum(p.cumulativeG, 0)} g`, p.note ?? "—"])} empty="未紀錄分段" />
              </Card>
            </div>
          </>
        );
      }}
    </Guard>
  );
}
