"use client";

import { D, fmtGrams, fmtMoney2, fmtNum } from "@/lib/decimal";
import { fmtDateTime, fmtDbDate } from "@/lib/time";
import { PROD_MODE, PROD_STATUS } from "@/lib/labels";
import { opAction } from "@/lib/api";
import { useCol, useDocument, type Row } from "@/lib/data";
import { Guard, useQS } from "@/lib/page";
import { basePath } from "@/lib/firebase";
import { ActionDialog } from "@/components/action-dialog";
import { StatusBadge } from "@/components/status";
import { A, Badge, Card, CardBody, CardHeader, KV, Notice, PageHeader, SimpleTable } from "@/components/ui";

export default function PODetail() {
  const id = useQS("id");
  const po = useDocument("productionOrders", id);
  const v = useDocument("variants", po.data?.targetVariantId);
  const pkg = useDocument("packagingBatches", po.data?.packagingBatchId);
  const traces = useCol(po.data?.packagingBatchId ? "traces" : null, [["packagingBatchId", po.data?.packagingBatchId]]);
  const costs = useCol("costEntries", [["productionOrderId", id]]);
  return (
    <Guard loading={po.loading} error={po.error} missing={!po.data}>
      {() => {
        const p = po.data!;
        const need = D(p.fillWeightG).mul(p.plannedQty);
        const trace = traces.data[0];
        return (
          <>
            <PageHeader
              title={`分裝單 ${p.orderNo}`}
              description={`${p.variantName}（${p.sku}）`}
              back={{ href: "/production/", label: "分裝生產" }}
              actions={
                p.status === "PLANNED" ? (
                  <>
                    <ActionDialog
                      label="完成分裝"
                      title="完成分裝"
                      description={`單一交易：扣熟豆 ${fmtNum(p.fillWeightG, 1)}g × 實際數量 + 損耗、扣包材、產出成品。任何一項不足則全部回滾。`}
                      payload={{ id: p.id }}
                      fields={[
                        { name: "actualQty", label: "實際生產數量（件）", type: "number", required: true, defaultValue: String(p.plannedQty) },
                        { name: "lossG", label: "額外包裝損耗（g）", type: "number", defaultValue: "0" },
                        { name: "laborCost", label: "包裝人工成本（TWD，估計）", type: "number" },
                        { name: "qualityStatus", label: "品質狀態", type: "select", options: [{ value: "PASS", label: "合格（可售）" }, { value: "HOLD", label: "保留（不可售）" }] },
                        { name: "expiryDate", label: "商品標示有效日期（選填）", type: "date", hint: "留空沿用熟豆批次之保存期限設定" },
                        { name: "note", label: "備註", type: "textarea" },
                      ]}
                      action={opAction("production.complete")}
                    />
                    {!p.orderId && <ActionDialog label="取消" variant="ghost" title="取消分裝單？" description="將釋放已預留的熟豆。" payload={{ id: p.id }} fields={[{ name: "reason", label: "原因" }]} action={opAction("production.cancel")} />}
                  </>
                ) : null
              }
            />
            <div className="grid gap-6">
              {p.orderId && (
                <Notice tone="warning">
                  接單後分裝：完成後成品將自動分配給 <A href={`/orders/view/?id=${p.orderId}`}>此訂單</A>。
                </Notice>
              )}
              <Card>
                <CardHeader title="生產資訊" action={<StatusBadge map={PROD_STATUS} value={p.status} />} />
                <CardBody>
                  <KV
                    cols={4}
                    items={[
                      ["類型", PROD_MODE[p.mode]],
                      ["熟豆批次", <A key="l" href={`/inventory/lot/?id=${p.sourceLotId}`}>{p.sourceLotCode}</A>],
                      ["烘焙批次", p.roastBatchId ? <A key="r" href={`/roasting/view/?id=${p.roastBatchId}`}>{p.sourceLotCode}</A> : "—"],
                      ["預計數量", `${p.plannedQty} 件`],
                      ["實際數量", p.actualQty != null ? `${p.actualQty} 件` : "—"],
                      ["單包重量", `${fmtNum(p.fillWeightG, 2)} g`],
                      ["熟豆預留", p.status === "PLANNED" ? fmtGrams(need, 1) : "已使用／已釋放"],
                      ["耗用熟豆", p.beansConsumedG ? fmtGrams(p.beansConsumedG, 1) : "—"],
                      ["損耗", p.lossG ? fmtGrams(p.lossG, 1) : "—"],
                      ["生產日期", fmtDbDate(p.plannedDate)],
                      ["完成時間", fmtDateTime(p.completedAt)],
                      ["品質狀態", p.qualityStatus === "PASS" ? "合格" : p.qualityStatus === "HOLD" ? "保留" : "不合格"],
                      ["備註", p.note],
                    ]}
                  />
                </CardBody>
              </Card>
              {pkg.data && (
                <Card>
                  <CardHeader title={`包裝批次 ${pkg.data.batchNo}`} description="成品批次可追溯至烘焙批次與生豆採購批次" />
                  <CardBody>
                    <KV
                      cols={4}
                      items={[
                        ["成品批次", <A key="o" href={`/inventory/lot/?id=${pkg.data.outputLotId}`}>{pkg.data.batchNo}</A>],
                        ["總成本", fmtMoney2(pkg.data.totalCost)],
                        ["每件成本", fmtMoney2(pkg.data.unitCost)],
                        ["有效日期", pkg.data.expiryDate ? `${fmtDbDate(pkg.data.expiryDate)}（${pkg.data.expirySource}）` : "未設定"],
                        ["QR 履歷", trace ? (trace.isPublished ? <a key="t" className="text-primary hover:underline" href={`${basePath}/t/?c=${trace.publicCode}`}>已發布</a> : <Badge key="t">未發布</Badge>) : "—"],
                      ]}
                    />
                  </CardBody>
                </Card>
              )}
              <Card>
                <CardHeader title={p.status === "COMPLETED" ? "實際耗用與成本計算" : "包材需求（每件）"} />
                {p.status === "COMPLETED" ? (
                  <SimpleTable
                    head={["類別", "批次", "數量", "單位成本", "小計"]}
                    rows={[
                      ...((p.consumptions as Row[]) ?? []).map((c) => [{ BEANS: "熟豆", LOSS: "分裝損耗", MATERIAL: "包材" }[c.kind as string], <A key="l" href={`/inventory/lot/?id=${c.lotId}`}>{c.lotCode}</A>, c.kind === "MATERIAL" ? `${fmtNum(c.quantity, 0)} 件` : fmtGrams(c.quantity, 1), fmtMoney2(c.unitCost), fmtMoney2(c.totalCost)]),
                      ...costs.data.map((c) => ["包裝人工" + (c.isEstimate ? "（估計）" : ""), "—", "—", "—", fmtMoney2(c.amount)]),
                      [<b key="t">合計</b>, "", "", "", <b key="v">{fmtMoney2(pkg.data?.totalCost)}</b>],
                    ]}
                  />
                ) : (
                  <SimpleTable head={["包材", "每件用量", `計畫需求（× ${p.plannedQty}）`]} rows={((v.data?.materials as Row[]) ?? []).map((m) => [m.materialName, fmtNum(m.quantityPerUnit, 2), fmtNum(D(m.quantityPerUnit).mul(p.plannedQty), 0)])} empty="此 SKU 未設定包材 BOM" />
                )}
              </Card>
            </div>
          </>
        );
      }}
    </Guard>
  );
}
