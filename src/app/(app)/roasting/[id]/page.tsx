import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D, fmtGrams, fmtMoney2, fmtNum, fmtPct } from "@/lib/decimal";
import { fmtDate, fmtDateTime, fmtDbDate, fmtSec, restDays } from "@/lib/time";
import { COST_CATEGORY, ROAST_EVENT } from "@/lib/labels";
import { freshnessOf } from "@/server/domain/roasting";
import { roastBatchCost } from "@/server/domain/reports";
import { Chart } from "@/components/chart";
import { ActionDialog } from "@/components/action-dialog";
import { A, Badge, Card, CardBody, CardHeader, EmptyState, KV, LinkButton, PageHeader, SimpleTable } from "@/components/ui";
import { activateCurve, updateRoastNotes } from "../actions";
import { curveOption } from "../curve-chart";
import { CurveImport } from "./curve-import";

export default async function RoastDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await prisma.roastBatch.findUnique({
    where: { id },
    include: {
      greenLot: { include: { coffee: true, inventoryLot: true } },
      roaster: true,
      events: { orderBy: { timeSec: "asc" } },
      curves: { orderBy: { importedAt: "desc" } },
      inventoryLot: { include: { productionOrdersAsSource: { include: { targetVariant: true } } } },
      cuppingSessions: { orderBy: { cuppedAt: "asc" } },
      brewSessions: { orderBy: { brewedAt: "asc" } },
    },
  });
  if (!b) notFound();
  const [cost, option] = await Promise.all([roastBatchCost(b.id), curveOption([b.id])]);
  const fresh = freshnessOf(b, b.greenLot.coffee);
  const age = restDays(b.roastedAt, new Date());
  const inPeak = fresh.peakFrom && fresh.peakTo && age >= fresh.peakFrom.value! && age <= fresh.peakTo.value!;

  return (
    <>
      <PageHeader
        title={`${b.batchNo}｜${b.greenLot.coffee.nameZh}`}
        description={`${fmtDateTime(b.roastedAt)} · ${b.roaster.name} · 烘後第 ${age} 天`}
        back={{ href: "/roasting", label: "烘焙中心" }}
        actions={
          <>
            <LinkButton href={`/roasting/new?copy=${b.id}`} variant="secondary">
              複製此批設定
            </LinkButton>
            <LinkButton href={`/cupping/new?roast=${b.id}`} variant="outline">
              ＋ 杯測
            </LinkButton>
            <LinkButton href={`/brewing/new?roast=${b.id}`} variant="outline">
              ＋ 手沖
            </LinkButton>
            {b.inventoryLot && (
              <LinkButton href={`/production/new?lot=${b.inventoryLot.id}`} variant="outline">
                ＋ 分裝
              </LinkButton>
            )}
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
                  ["生豆批次", <A key="g" href={`/inventory/lots/${b.greenLot.inventoryLot?.id}`}>{b.greenLot.lotCode}</A>],
                  ["投入生豆", fmtGrams(b.greenWeightG, 1)],
                  ["出爐熟豆", fmtGrams(b.roastedWeightG, 1)],
                  ["失重率", fmtPct(b.weightLossPercent, 2)],
                  ["入豆溫", b.chargeTempC ? `${b.chargeTempC}°C` : "—"],
                  ["轉折點", b.turningPointSec != null ? `${fmtSec(b.turningPointSec)}${b.turningPointTempC ? ` / ${b.turningPointTempC}°C` : ""}` : "—"],
                  ["轉黃點", fmtSec(b.dryEndSec)],
                  ["一爆開始", fmtSec(b.firstCrackStartSec)],
                  ["一爆結束", fmtSec(b.firstCrackEndSec)],
                  ["下豆", b.dropSec != null ? `${fmtSec(b.dropSec)}${b.dropTempC ? ` / ${b.dropTempC}°C` : ""}` : "—"],
                  ["總烘焙時間", fmtSec(b.totalTimeSec)],
                  ["脫水期", fmtSec(b.dryingPhaseSec)],
                  ["梅納期", fmtSec(b.maillardPhaseSec)],
                  ["發展期", fmtSec(b.developmentPhaseSec)],
                  ["DTR", fmtPct(b.dtrPercent, 2)],
                  ["烘焙程度", b.roastLevel],
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
                  ["熟豆批次", b.inventoryLot ? <A key="l" href={`/inventory/lots/${b.inventoryLot.id}`}>{b.inventoryLot.lotCode}</A> : "—"],
                  ["在庫／已預留", b.inventoryLot ? `${fmtGrams(b.inventoryLot.onHand, 1)}／${fmtGrams(b.inventoryLot.reserved, 1)}` : "—"],
                  ["建議養豆", fresh.restStart ? `第 ${fresh.restStart.value} 天起（${fresh.restStart.source}）` : "未設定"],
                  ["最佳風味觀察區間", fresh.peakFrom ? `第 ${fresh.peakFrom.value}–${fresh.peakTo?.value ?? "?"} 天（${fresh.peakFrom.source}）` : "未設定"],
                  ["商品標示有效日期", b.inventoryLot?.expiryDate ? `${fmtDbDate(b.inventoryLot.expiryDate)}（${b.inventoryLot.expirySource}）` : "未設定"],
                  ["目前狀態", inPeak ? <Badge key="p" tone="sage">最佳風味觀察區間內</Badge> : `烘後第 ${age} 天`],
                ]}
              />
              <p className="text-xs text-muted">最佳風味區間為內部觀察建議，不等於食品有效日期。</p>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="烘焙曲線" description="點選圖例可分別顯示／隱藏 BT、ET、RoR；虛線為事件標記" action={<A href={`/roasting/compare?ids=${b.id}`}>疊圖比較</A>} />
          <CardBody>
            {option ? <Chart option={option} height={380} ariaLabel={`${b.batchNo} 烘焙曲線`} /> : <EmptyState title="尚無曲線資料" description="可於下方匯入 CSV 或 Artisan .alog 檔。系統不會以不存在的資料繪製曲線。" />}
            {b.curves.length > 0 && (
              <div className="mt-4">
                <SimpleTable
                  head={["來源", "檔名", "資料點", "RoR", "匯入時間", "狀態"]}
                  rows={b.curves.map((c) => [
                    { MANUAL: "手動", CSV: "CSV", ARTISAN_ALOG: "Artisan .alog" }[c.source],
                    c.storageKey ? <a key="f" className="text-primary hover:underline" href={`/api/files/${c.storageKey}`}>{c.originalFileName}</a> : (c.originalFileName ?? "—"),
                    c.pointCount,
                    c.rorComputed ? "由 BT 計算" : "檔案提供",
                    fmtDateTime(c.importedAt),
                    c.isActive ? <Badge key="a" tone="sage">使用中</Badge> : <ActionDialog key="b" label="設為使用中" size="sm" variant="ghost" title="切換使用中曲線？" payload={{ curveId: c.id }} action={activateCurve} />,
                  ])}
                />
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="匯入曲線" description="保存原始檔與正規化時序資料；同一檔案（SHA-256）重複匯入會被拒絕。Olomo 原生格式尚未取得可驗證規格，請先匯出 CSV。" />
          <CardBody>
            <CurveImport roastBatchId={b.id} />
          </CardBody>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="成本來源" description="熟豆每克成本 = (生豆成本 + 烘焙附加成本) ÷ 出爐重量" />
            <SimpleTable
              head={["項目", "計算", "金額"]}
              rows={[
                ["生豆成本", `${fmtGrams(cost.greenWeightG, 1)} × ${fmtMoney2(cost.greenCostPerG)}/g`, fmtMoney2(cost.greenCostTotal)],
                ...cost.extras.map((c) => [`${COST_CATEGORY[c.category]}${c.isEstimate ? "（估計）" : "（實際）"}`, c.calcNote ?? "—", fmtMoney2(c.amount)]),
                ["合計", "", fmtMoney2(cost.total)],
                ["熟豆每克成本", `÷ ${fmtGrams(cost.roastedWeightG, 1)}`, `${fmtMoney2(cost.roastedCostPerG)} / g`],
              ]}
            />
          </Card>
          <Card>
            <CardHeader title="時間事件" />
            <SimpleTable
              head={["時間", "事件", "BT", "ET", "火力／風門", "備註"]}
              rows={b.events.map((e) => [fmtSec(e.timeSec), ROAST_EVENT[e.type], e.btC ? `${e.btC}°C` : "—", e.etC ? `${e.etC}°C` : "—", [e.heat, e.airflow].filter(Boolean).join(" / ") || "—", e.note ?? "—"])}
              empty="無額外事件紀錄（主要事件見上方烘焙數據）"
            />
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="杯測紀錄" action={<A href={`/cupping/new?roast=${b.id}`}>＋ 新增</A>} />
            <SimpleTable head={["日期", "烘後天數", "平均分", ""]} rows={b.cuppingSessions.map((c) => [fmtDate(c.cuppedAt), `${c.restDays} 天`, fmtNum(c.totalScore, 2), <A key="v" href={`/cupping/${c.id}`}>查看</A>])} empty="尚無杯測" />
          </Card>
          <Card>
            <CardHeader title="分裝紀錄" />
            <SimpleTable
              head={["生產單", "SKU", "數量", "狀態"]}
              rows={(b.inventoryLot?.productionOrdersAsSource ?? []).map((p) => [<A key="p" href={`/production/${p.id}`}>{p.orderNo}</A>, p.targetVariant.sku, p.actualQty ?? p.plannedQty, p.status === "COMPLETED" ? "已完成" : p.status === "PLANNED" ? "規劃中" : "已取消"])}
              empty="尚無分裝"
            />
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
                description="已過帳的重量與時間無法修改；如有錯誤請以庫存沖銷交易處理。"
                payload={{ id: b.id }}
                fields={[
                  { name: "roastLevel", label: "烘焙程度", defaultValue: b.roastLevel ?? "" },
                  { name: "targetProfile", label: "烘焙目標", defaultValue: b.targetProfile ?? "" },
                  { name: "qualityRating", label: "品質評價（1–10）", type: "number", defaultValue: b.qualityRating?.toString() ?? "" },
                  { name: "result", label: "烘焙結果", type: "textarea", defaultValue: b.result ?? "" },
                  { name: "note", label: "備註", type: "textarea", defaultValue: b.note ?? "" },
                ]}
                action={updateRoastNotes}
              />
            }
          />
          <CardBody>
            <KV cols={4} items={[["烘焙目標", b.targetProfile], ["烘焙結果", b.result], ["品質評價", b.qualityRating ? `${b.qualityRating} / 10` : "—"], ["備註", b.note]]} />
            {b.copiedFromId && <p className="mt-3 text-xs text-muted">此批次設定複製自先前批次。</p>}
            <p className="mt-2 text-xs text-muted">熟豆可用量：{fmtGrams(D(b.inventoryLot?.onHand ?? 0).sub(b.inventoryLot?.reserved ?? 0), 1)}</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
