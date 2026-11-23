"use client";

import { D, fmtGrams, fmtMoney2, fmtNum, fmtPct } from "@/lib/decimal";
import { fmtDate, fmtDateTime, fmtDbDate, fmtSec, restDays } from "@/lib/time";
import { COST_CATEGORY, ROAST_EVENT } from "@/lib/labels";
import { opAction } from "@/lib/api";
import { useCol, useDocument, type Row } from "@/lib/data";
import { Guard, useQS } from "@/lib/page";
import { freshnessOf } from "@/lib/freshness";
import { ActionDialog } from "@/components/action-dialog";
import { DeleteButton } from "@/components/delete-button";
import { A, Badge, Card, CardBody, CardHeader, KV, LinkButton, PageHeader, SimpleTable } from "@/components/ui";
import { CurveChart, CurveImport } from "../curve";

export default function RoastDetail() {
  const id = useQS("id");
  const b = useDocument("roastBatches", id);
  const coffee = useDocument("coffees", b.data?.coffeeId);
  const lot = useDocument("invLots", b.data?.invLotId);
  const greenLot = useDocument("greenLots", b.data?.greenLotId);
  const curves = useCol("roastCurves", [["roastBatchId", id]], "importedAt");
  const costs = useCol("costEntries", [["roastBatchId", id]]);
  const cups = useCol("cuppingSessions", [["roastBatchId", id]], "cuppedAt", false);
  const pos = useCol("productionOrders", [["roastBatchId", id]]);
  return (
    <Guard loading={b.loading} error={b.error} missing={!b.data}>
      {() => {
        const x = b.data as Row;
        const fresh = freshnessOf(x, coffee.data ?? {});
        const age = restDays(new Date(x.roastedAt), new Date());
        const inPeak = fresh.peakFrom && fresh.peakTo && age >= fresh.peakFrom.value && age <= fresh.peakTo.value;
        const extras = costs.data.reduce((s, c) => s.add(c.amount), D(0));
        const total = D(x.greenCostTotal).add(extras);
        return (
          <>
            <PageHeader
              title={`${x.batchNo}｜${x.coffeeName}`}
              description={`${fmtDateTime(x.roastedAt)} · ${x.roasterName} · 烘後第 ${age} 天`}
              back={{ href: "/roasting/", label: "烘豆紀錄" }}
              actions={
                <>
                  <LinkButton href={`/roasting/new/?edit=${x.id}`} variant="secondary">
                    修改
                  </LinkButton>
                  <ActionDialog
                    label="刪除"
                    variant="danger"
                    title={`刪除 ${x.batchNo}？`}
                    description="投入的生豆會退回庫存，這批熟豆、曲線與成本會一起刪除。已有杯測、手沖，或熟豆已分裝、出貨的批次不能刪除。"
                    confirmLabel="確認刪除"
                    payload={{ id: x.id }}
                    action={opAction("roast.delete")}
                    redirectTo="/roasting/"
                  />
                  <LinkButton href={`/roasting/new/?copy=${x.id}`} variant="outline">
                    複製此批設定
                  </LinkButton>
                  <LinkButton href={`/cupping/new/?roast=${x.id}`} variant="outline">
                    ＋ 杯測
                  </LinkButton>
                  <LinkButton href={`/brewing/new/?roast=${x.id}`} variant="outline">
                    ＋ 手沖
                  </LinkButton>
                  <LinkButton href={`/production/new/?lot=${x.invLotId}`} variant="outline">
                    ＋ 分裝
                  </LinkButton>
                </>
              }
            />
            <div className="grid gap-6">
              <div className="grid gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader title="烘焙數據" description="失重率 = (投入 − 產出) ÷ 投入；DTR = 發展期 ÷ 總烘焙時間。缺少事件時不計算。" />
                  <CardBody>
                    <KV
                      cols={4}
                      items={[
                        ["生豆批次", <A key="g" href={`/inventory/lot/?id=${greenLot.data?.invLotId}`}>{x.greenLotCode}</A>],
                        ["投入生豆", fmtGrams(x.greenWeightG, 1)],
                        ["出爐熟豆", fmtGrams(x.roastedWeightG, 1)],
                        ["失重率", fmtPct(x.weightLossPercent, 2)],
                        ["入豆溫", x.chargeTempC ? `${x.chargeTempC}°C` : "—"],
                        ["轉折點", x.turningPointSec != null ? `${fmtSec(x.turningPointSec)}${x.turningPointTempC ? ` / ${x.turningPointTempC}°C` : ""}` : "—"],
                        ["轉黃點", fmtSec(x.dryEndSec)],
                        ["一爆開始", fmtSec(x.firstCrackStartSec)],
                        ["一爆結束", fmtSec(x.firstCrackEndSec)],
                        ["下豆", x.dropSec != null ? `${fmtSec(x.dropSec)}${x.dropTempC ? ` / ${x.dropTempC}°C` : ""}` : "—"],
                        ["總烘焙時間", fmtSec(x.totalTimeSec)],
                        ["脫水期", fmtSec(x.dryingPhaseSec)],
                        ["梅納期", fmtSec(x.maillardPhaseSec)],
                        ["發展期", fmtSec(x.developmentPhaseSec)],
                        ["DTR", fmtPct(x.dtrPercent, 2)],
                        ["烘焙程度", x.roastLevel],
                      ]}
                    />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="熟豆庫存與賞味" />
                  <CardBody className="space-y-4">
                    <KV
                      cols={2}
                      items={[
                        ["熟豆批次", <A key="l" href={`/inventory/lot/?id=${x.invLotId}`}>{x.batchNo}</A>],
                        ["在庫／已預留", lot.data ? `${fmtGrams(lot.data.onHand, 1)}／${fmtGrams(lot.data.reserved, 1)}` : "—"],
                        ["建議養豆", fresh.restStart ? `第 ${fresh.restStart.value} 天起（${fresh.restStart.source}）` : "未設定"],
                        ["最佳風味觀察區間", fresh.peakFrom ? `第 ${fresh.peakFrom.value}–${fresh.peakTo?.value ?? "?"} 天（${fresh.peakFrom.source}）` : "未設定"],
                        ["商品標示有效日期", lot.data?.expiryDate ? `${fmtDbDate(lot.data.expiryDate)}（${lot.data.expirySource}）` : "未設定"],
                        ["目前狀態", inPeak ? <Badge key="p" tone="sage">最佳風味觀察區間內</Badge> : `烘後第 ${age} 天`],
                      ]}
                    />
                    <p className="text-xs text-muted">最佳風味區間為內部觀察建議，不等於食品有效日期。</p>
                  </CardBody>
                </Card>
              </div>
              <Card>
                <CardHeader title="烘焙曲線" description="點選圖例可分別顯示／隱藏 BT、ET、RoR；虛線為事件標記" action={<A href={`/roasting/compare/?ids=${x.id}`}>疊圖比較</A>} />
                <CardBody>
                  <CurveChart batches={[x]} />
                  {curves.data.length > 0 && (
                    <div className="mt-4">
                      <SimpleTable
                        head={["來源", "檔名", "資料點", "RoR", "匯入時間", "狀態", ""]}
                        rows={curves.data.map((c) => [
                          { MANUAL: "手動", CSV: "CSV", ARTISAN_ALOG: "Artisan .alog" }[c.source as string],
                          c.originalFileName ?? "—",
                          c.pointCount,
                          c.rorComputed ? "由 BT 計算" : "檔案提供",
                          fmtDateTime(c.importedAt),
                          c.isActive ? <Badge key="a" tone="sage">使用中</Badge> : <ActionDialog key="b" label="設為使用中" size="sm" variant="ghost" title="切換使用中曲線？" payload={{ curveId: c.id }} action={opAction("curve.activate")} />,
                          <DeleteButton key="d" what="這份曲線" id={c.id} op="curve.delete" payload={{ curveId: c.id }} description="刪除這份曲線資料；若是使用中的曲線，會改用最近一份。" />,
                        ])}
                      />
                    </div>
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="匯入曲線" description="原始檔保存於 Cloud Storage；同一檔案（SHA-256）重複匯入會被拒絕。Olomo 原生格式尚未取得可驗證規格，請先匯出 CSV。" />
                <CardBody>
                  <CurveImport roastBatchId={x.id} />
                </CardBody>
              </Card>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader title="成本來源" description="熟豆每克成本 = (生豆成本 + 烘焙附加成本) ÷ 出爐重量" />
                  <SimpleTable
                    head={["項目", "計算", "金額"]}
                    rows={[
                      ["生豆成本", `${fmtGrams(x.greenWeightG, 1)} × ${fmtMoney2(greenLot.data?.costPerG)}/g（入庫時）`, fmtMoney2(x.greenCostTotal)],
                      ...costs.data.map((c) => [`${COST_CATEGORY[c.category]}${c.isEstimate ? "（估計）" : "（實際）"}`, c.calcNote ?? "—", fmtMoney2(c.amount)]),
                      ["合計", "", fmtMoney2(total)],
                      ["熟豆每克成本", `÷ ${fmtGrams(x.roastedWeightG, 1)}`, `${fmtMoney2(lot.data?.unitCost ?? total.div(x.roastedWeightG))} / g`],
                    ]}
                  />
                </Card>
                <Card>
                  <CardHeader title="時間事件" />
                  <SimpleTable head={["時間", "事件", "BT", "ET", "火力／風門", "備註"]} rows={((x.events as Row[]) ?? []).sort((a, c) => a.timeSec - c.timeSec).map((e) => [fmtSec(e.timeSec), ROAST_EVENT[e.type] ?? e.type, e.btC ? `${e.btC}°C` : "—", e.etC ? `${e.etC}°C` : "—", [e.heat, e.airflow].filter(Boolean).join(" / ") || "—", e.note ?? "—"])} empty="無額外事件紀錄（主要事件見上方烘焙數據）" />
                </Card>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader title="杯測紀錄" action={<A href={`/cupping/new/?roast=${x.id}`}>＋ 新增</A>} />
                  <SimpleTable head={["日期", "烘後天數", "平均分", ""]} rows={cups.data.map((c) => [fmtDate(c.cuppedAt), `${c.restDays} 天`, fmtNum(c.totalScore, 2), <A key="v" href={`/cupping/view/?id=${c.id}`}>查看</A>])} empty="尚無杯測" />
                </Card>
                <Card>
                  <CardHeader title="分裝紀錄" />
                  <SimpleTable head={["生產單", "品項編號", "數量", "狀態"]} rows={pos.data.map((p) => [<A key="p" href={`/production/view/?id=${p.id}`}>{p.orderNo}</A>, p.sku, p.actualQty ?? p.plannedQty, p.status === "COMPLETED" ? "已完成" : p.status === "PLANNED" ? "規劃中" : "已取消"])} empty="尚無分裝" />
                </Card>
              </div>
              <Card>
                <CardHeader
                  title="評價與備註"
                  action={
                    <ActionDialog
                      label="編輯"
                      size="sm"
                      variant="outline"
                      title="編輯評價與備註"
                      description="重量、時間等其他欄位請按上方「修改」。"
                      payload={{ id: x.id }}
                      fields={[
                        { name: "roastLevel", label: "烘焙程度", defaultValue: x.roastLevel ?? "" },
                        { name: "targetProfile", label: "烘焙目標", defaultValue: x.targetProfile ?? "" },
                        { name: "qualityRating", label: "品質評價（1–10）", type: "number", defaultValue: x.qualityRating?.toString() ?? "" },
                        { name: "result", label: "烘焙結果", type: "textarea", defaultValue: x.result ?? "" },
                        { name: "note", label: "備註", type: "textarea", defaultValue: x.note ?? "" },
                      ]}
                      action={opAction("roast.updateNotes")}
                    />
                  }
                />
                <CardBody>
                  <KV cols={4} items={[["烘焙目標", x.targetProfile], ["烘焙結果", x.result], ["品質評價", x.qualityRating ? `${x.qualityRating} / 10` : "—"], ["備註", x.note]]} />
                  {x.copiedFromId && <p className="mt-3 text-xs text-muted">此批次設定複製自先前批次。</p>}
                </CardBody>
              </Card>
            </div>
          </>
        );
      }}
    </Guard>
  );
}
