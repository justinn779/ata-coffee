"use client";

import { useState } from "react";
import { D, fmtGrams, fmtMoney2, fmtNum } from "@/lib/decimal";
import { fmtDateTime, fmtDbDate } from "@/lib/time";
import { LOT_STATUS } from "@/lib/labels";
import { opAction } from "@/lib/api";
import { useCol, useDocument } from "@/lib/data";
import { Guard, useQS } from "@/lib/page";
import { ActionDialog } from "@/components/action-dialog";
import { StatusBadge } from "@/components/status";
import { A, Badge, Card, CardBody, CardHeader, KV, PageHeader, SimpleTable } from "@/components/ui";

const TX: Record<string, string> = { RECEIPT: "入庫", ROAST_ISSUE: "烘焙領料", ROAST_OUTPUT: "烘焙產出", CUPPING_USE: "杯測耗用", TASTING_USE: "試喝耗用", SAMPLE_GIFT: "樣品贈送", PACKAGING_ISSUE: "分裝耗用", PACKAGING_LOSS: "分裝損耗", PACKAGING_OUTPUT: "分裝產出", MATERIAL_ISSUE: "包材耗用", SCRAP: "報廢", ADJUSTMENT: "盤點調整", SHIPMENT_ISSUE: "出貨扣帳", RETURN_QUARANTINE: "退貨待檢", RETURN_RESTOCK_OUT: "退貨轉出待檢區", RETURN_RESTOCK_IN: "退貨重新入庫", REVERSAL: "沖銷" };
const MANUAL = ["CUPPING_USE", "TASTING_USE", "SAMPLE_GIFT", "SCRAP", "ADJUSTMENT"];
const KIND: Record<string, string> = { GREEN: "生豆", ROASTED: "熟豆", FINISHED: "成品", MATERIAL: "包材" };

export default function LotPage() {
  const id = useQS("id");
  const lot = useDocument("invLots", id);
  const txs = useCol("invTxs", [["lotId", id]], "occurredAt");
  const resv = useCol("reservations", [["lotId", id]], "createdAt");
  const reversals = useCol("invTxReversals");
  const green = useDocument("greenLots", lot.data?.greenLotId);
  const pkg = useDocument("packagingBatches", lot.data?.packagingBatchId);
  const [idem] = useState(() => crypto.randomUUID());
  const reversed = new Set(reversals.data.map((r) => r.id));
  return (
    <Guard loading={lot.loading} error={lot.error} missing={!lot.data}>
      {() => {
        const l = lot.data!;
        const q = (v: unknown) => (l.unit === "G" ? fmtGrams(v as string, 1) : `${fmtNum(v as string, 0)} 件`);
        return (
          <>
            <PageHeader
              title={`${KIND[l.kind]}批次 ${l.lotCode}`}
              description={l.itemName}
              back={{ href: `/inventory/?kind=${l.kind}`, label: "庫存中心" }}
              actions={
                <>
                  {l.status !== "QUARANTINE" && D(l.onHand).gt(0) && (
                    <ActionDialog
                      label="異動／盤點"
                      title="手動庫存異動"
                      description="杯測、試喝、樣品、報廢為扣除；盤點調整可增可減且必須填寫原因。過帳後不可修改，只能沖銷。"
                      payload={{ lotId: l.id, idempotencyKey: idem }}
                      fields={[
                        { name: "type", label: "異動類型", type: "select", required: true, options: MANUAL.map((t) => ({ value: t, label: TX[t] })) },
                        { name: "direction", label: "方向（僅盤點調整適用）", type: "select", options: [{ value: "out", label: "減少" }, { value: "in", label: "增加" }] },
                        { name: "quantity", label: `數量（${l.unit === "G" ? "g" : "件"}）`, type: "number", required: true },
                        { name: "note", label: "原因／備註", type: "textarea" },
                      ]}
                      action={opAction("inventory.adjust")}
                    />
                  )}
                  {(l.status === "AVAILABLE" || l.status === "HOLD") && (
                    <ActionDialog label={l.status === "HOLD" ? "解除品質保留" : "品質保留"} variant="outline" title={l.status === "HOLD" ? "解除品質保留（恢復可售）" : "設為品質保留（不可售）"} payload={{ lotId: l.id, status: l.status === "HOLD" ? "AVAILABLE" : "HOLD" }} fields={[{ name: "note", label: "原因", required: true }]} action={opAction("inventory.lotStatus")} />
                  )}
                  {green.data && (
                    <ActionDialog
                      label="成本更正"
                      variant="ghost"
                      title="生豆成本更正"
                      description="只影響此批次剩餘庫存之後續交易；已建立的烘焙批次、成品與訂單成本快照不變。"
                      payload={{ greenLotId: green.data.id }}
                      fields={[
                        { name: "unitPricePerKg", label: "每公斤單價", type: "number", required: true, defaultValue: green.data.unitPricePerKg },
                        { name: "shippingCost", label: "運費", type: "number", defaultValue: green.data.shippingCost },
                        { name: "otherCost", label: "其他費用", type: "number", defaultValue: green.data.otherCost },
                        { name: "reason", label: "更正原因", required: true },
                      ]}
                      action={opAction("green.correctCost")}
                    />
                  )}
                </>
              }
            />
            <div className="grid gap-6">
              <Card>
                <CardHeader title="批次資訊" action={<StatusBadge map={LOT_STATUS} value={l.status} />} />
                <CardBody>
                  <KV
                    cols={4}
                    items={[
                      ["在庫", q(l.onHand)],
                      ["已保留", q(l.reserved)],
                      ["可用", <b key="a">{q(D(l.onHand).sub(l.reserved))}</b>],
                      ["單位成本", `${fmtMoney2(l.unitCost)} / ${l.unit === "G" ? "g" : "件"}`],
                      ["庫存價值", fmtMoney2(D(l.onHand).mul(l.unitCost))],
                      ["生產／入庫", fmtDateTime(l.producedAt ?? l.createdAt)],
                      ["商品標示有效日期", fmtDbDate(l.expiryDate)],
                      ["有效日期來源", l.expirySource],
                      ["來源", green.data ? `採購 ${green.data.purchaseNo}（${green.data.supplierName ?? "未指定供應商"}）` : l.roastBatchId ? <A key="r" href={`/roasting/view/?id=${l.roastBatchId}`}>烘焙 {l.lotCode}</A> : pkg.data ? <A key="p" href={`/production/view/?id=${pkg.data.productionOrderId}`}>包裝 {pkg.data.batchNo}</A> : l.returnSourceLotId ? <A key="q" href={`/inventory/lot/?id=${l.returnSourceLotId}`}>退貨自原批次</A> : "手動入庫"],
                      ...(pkg.data?.roastBatchId ? [["原始烘焙批次", <A key="o" href={`/roasting/view/?id=${pkg.data.roastBatchId}`}>查看</A>] as [string, React.ReactNode]] : []),
                      ...(green.data ? ([["含水率／密度", `${fmtNum(green.data.moisturePercent, 1)}%／${fmtNum(green.data.densityGPerL, 0)} g/L`], ["發票", green.data.invoiceNo]] as Array<[string, React.ReactNode]>) : []),
                      ["備註", l.note],
                    ]}
                  />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="庫存帳本" description="每筆異動皆有唯一交易識別碼；不可修改或刪除，錯誤以沖銷交易更正" />
                <SimpleTable
                  head={["時間", "類型", "異動量", "結餘", "單位成本", "來源", "操作者", "備註", "交易 ID", ""]}
                  rows={txs.data.map((t) => [
                    fmtDateTime(t.occurredAt),
                    <span key="t">{TX[t.type]} {reversed.has(t.id) && <Badge>已沖銷</Badge>}</span>,
                    <span key="q" className={D(t.quantity).isNegative() ? "text-danger" : "text-sage"}>{D(t.quantity).isNegative() ? "" : "+"}{fmtNum(t.quantity, l.unit === "G" ? 1 : 0)}</span>,
                    fmtNum(t.balanceAfter, l.unit === "G" ? 1 : 0),
                    fmtNum(t.unitCost, 4),
                    t.refType === "SalesOrder" ? <A key="r" href={`/orders/view/?id=${t.refId}`}>訂單</A> : t.refType === "RoastBatch" ? <A key="r" href={`/roasting/view/?id=${t.refId}`}>烘焙</A> : t.refType === "ProductionOrder" ? <A key="r" href={`/production/view/?id=${t.refId}`}>分裝</A> : (t.refType ?? "—"),
                    t.actorName ?? "系統",
                    t.note ?? "—",
                    <code key="id" className="text-[10px] text-muted">{t.id.slice(0, 8)}</code>,
                    !reversed.has(t.id) && [...MANUAL, "RECEIPT"].includes(t.type) ? <ActionDialog key="rv" label="沖銷" size="sm" variant="ghost" title="沖銷此交易？" description="將建立一筆反向交易，原交易保留於帳本。" payload={{ txId: t.id }} fields={[{ name: "note", label: "沖銷原因", required: true }]} action={opAction("inventory.reverse")} /> : "",
                  ])}
                />
              </Card>
              <Card>
                <CardHeader title="保留紀錄" description="訂單保留成品／分裝預留熟豆；狀態變更保留歷史" />
                <SimpleTable
                  head={["建立", "用途", "數量", "狀態", "對象", "釋放／使用時間"]}
                  rows={resv.data.map((r) => [
                    fmtDateTime(r.createdAt),
                    r.purpose === "ORDER" ? "訂單保留" : "分裝預留",
                    q(r.quantity),
                    r.status === "ACTIVE" ? <Badge key="s" tone="warning">保留中</Badge> : r.status === "CONSUMED" ? <Badge key="s" tone="sage">已使用</Badge> : <Badge key="s">已釋放</Badge>,
                    r.orderId ? <A key="o" href={`/orders/view/?id=${r.orderId}`}>訂單</A> : r.productionOrderId ? <A key="p" href={`/production/view/?id=${r.productionOrderId}`}>分裝單</A> : "—",
                    fmtDateTime(r.consumedAt ?? r.releasedAt),
                  ])}
                  empty="無保留紀錄"
                />
              </Card>
            </div>
          </>
        );
      }}
    </Guard>
  );
}
