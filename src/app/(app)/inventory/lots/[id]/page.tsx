import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D, fmtGrams, fmtMoney2, fmtNum } from "@/lib/decimal";
import { fmtDateTime, fmtDbDate } from "@/lib/time";
import { LOT_STATUS } from "@/lib/labels";
import { KIND_LABEL, MANUAL_TX_TYPES, TX_LABEL } from "@/server/domain/inventory";
import { ActionDialog } from "@/components/action-dialog";
import { StatusBadge } from "@/components/status";
import { A, Badge, Card, CardBody, CardHeader, KV, PageHeader, SimpleTable } from "@/components/ui";
import { adjustLot, reverseTx, setLotStatus } from "../../actions";
import { correctCost } from "../../../coffees/actions";

export default async function LotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lot = await prisma.inventoryLot.findUnique({
    where: { id },
    include: {
      item: true,
      location: true,
      greenLot: { include: { purchase: { include: { supplier: true } }, coffee: true } },
      roastBatch: true,
      packagingBatch: { include: { productionOrder: { include: { sourceLot: { include: { roastBatch: true } } } } } },
      returnSourceLot: true,
      transactions: { orderBy: { occurredAt: "desc" }, include: { actor: true, reversedBy: true } },
      reservations: { orderBy: { createdAt: "desc" }, include: { salesOrderItem: { include: { order: true } }, productionOrder: true } },
    },
  });
  if (!lot) notFound();
  const u = lot.item.unit;
  const q = (v: unknown) => (u === "G" ? fmtGrams(v as string, 1) : `${fmtNum(v as string, 0)} 件`);
  const available = D(lot.onHand).sub(lot.reserved);
  return (
    <>
      <PageHeader
        title={`${KIND_LABEL[lot.item.kind]}批次 ${lot.lotCode}`}
        description={lot.item.name}
        back={{ href: `/inventory?kind=${lot.item.kind}`, label: "庫存中心" }}
        actions={
          <>
            {lot.status !== "QUARANTINE" && D(lot.onHand).gt(0) && (
              <ActionDialog
                label="異動／盤點"
                title="手動庫存異動"
                description="杯測、試喝、樣品、報廢為扣除；盤點調整可增可減且必須填寫原因。過帳後不可修改，只能沖銷。"
                payload={{ lotId: lot.id, idempotencyKey: crypto.randomUUID() }}
                fields={[
                  { name: "type", label: "異動類型", type: "select", required: true, options: MANUAL_TX_TYPES.map((t) => ({ value: t, label: TX_LABEL[t] })) },
                  { name: "direction", label: "方向（僅盤點調整適用）", type: "select", options: [{ value: "out", label: "減少" }, { value: "in", label: "增加" }] },
                  { name: "quantity", label: `數量（${u === "G" ? "g" : "件"}）`, type: "number", required: true },
                  { name: "note", label: "原因／備註", type: "textarea" },
                ]}
                action={adjustLot}
              />
            )}
            {lot.status === "AVAILABLE" || lot.status === "HOLD" ? (
              <ActionDialog
                label={lot.status === "HOLD" ? "解除品質保留" : "品質保留"}
                variant="outline"
                title={lot.status === "HOLD" ? "解除品質保留（恢復可售）" : "設為品質保留（不可售）"}
                payload={{ lotId: lot.id, status: lot.status === "HOLD" ? "AVAILABLE" : "HOLD" }}
                fields={[{ name: "note", label: "原因", required: true }]}
                action={setLotStatus}
              />
            ) : null}
            {lot.greenLot && (
              <ActionDialog
                label="成本更正"
                variant="ghost"
                title="生豆成本更正"
                description="只影響此批次剩餘庫存之後續交易；已建立的烘焙批次、成品與訂單成本快照不變。"
                payload={{ greenLotId: lot.greenLot.id }}
                fields={[
                  { name: "unitPricePerKg", label: "每公斤單價", type: "number", required: true, defaultValue: lot.greenLot.unitPricePerKg.toString() },
                  { name: "shippingCost", label: "運費", type: "number", defaultValue: lot.greenLot.shippingCost.toString() },
                  { name: "otherCost", label: "其他費用", type: "number", defaultValue: lot.greenLot.otherCost.toString() },
                  { name: "reason", label: "更正原因", required: true },
                ]}
                action={correctCost}
              />
            )}
          </>
        }
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader title="批次資訊" action={<StatusBadge map={LOT_STATUS} value={lot.status} />} />
          <CardBody>
            <KV
              cols={4}
              items={[
                ["在庫", q(lot.onHand)],
                ["已保留", q(lot.reserved)],
                ["可用", <b key="a">{q(available)}</b>],
                ["單位成本", `${fmtMoney2(lot.unitCost)} / ${u === "G" ? "g" : "件"}`],
                ["庫存價值", fmtMoney2(D(lot.onHand).mul(lot.unitCost))],
                ["生產／入庫", fmtDateTime(lot.producedAt ?? lot.createdAt)],
                ["商品標示有效日期", lot.expiryDate ? `${fmtDbDate(lot.expiryDate)}` : "—"],
                ["有效日期來源", lot.expirySource],
                ["儲存位置", lot.location?.name],
                ["來源", lot.greenLot ? `採購 ${lot.greenLot.purchase.purchaseNo}（${lot.greenLot.purchase.supplier?.name ?? "未指定供應商"}）` : lot.roastBatch ? <A key="r" href={`/roasting/${lot.roastBatch.id}`}>烘焙 {lot.roastBatch.batchNo}</A> : lot.packagingBatch ? <A key="p" href={`/production/${lot.packagingBatch.productionOrderId}`}>分裝 {lot.packagingBatch.productionOrder.orderNo}</A> : lot.returnSourceLot ? <A key="q" href={`/inventory/lots/${lot.returnSourceLot.id}`}>退貨自 {lot.returnSourceLot.lotCode}</A> : "手動入庫"],
                ...(lot.packagingBatch?.productionOrder.sourceLot.roastBatch ? [["原始烘焙批次", <A key="o" href={`/roasting/${lot.packagingBatch.productionOrder.sourceLot.roastBatch.id}`}>{lot.packagingBatch.productionOrder.sourceLot.roastBatch.batchNo}</A>] as [string, React.ReactNode]] : []),
                ...(lot.greenLot ? ([["含水率／密度", `${fmtNum(lot.greenLot.moisturePercent, 1)}%／${fmtNum(lot.greenLot.densityGPerL, 0)} g/L`], ["發票", lot.greenLot.purchase.invoiceNo]] as Array<[string, React.ReactNode]>) : []),
                ["備註", lot.note],
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="庫存帳本" description="每筆異動皆有唯一交易識別碼；不可修改或刪除，錯誤以沖銷交易更正" />
          <SimpleTable
            head={["時間", "類型", "異動量", "結餘", "單位成本", "來源", "操作者", "備註", "交易 ID", ""]}
            rows={lot.transactions.map((t) => [
              fmtDateTime(t.occurredAt),
              <span key="t">
                {TX_LABEL[t.type]} {t.reversedBy && <Badge>已沖銷</Badge>}
              </span>,
              <span key="q" className={D(t.quantity).isNegative() ? "text-danger" : "text-sage"}>
                {D(t.quantity).isNegative() ? "" : "+"}
                {fmtNum(t.quantity, u === "G" ? 1 : 0)}
              </span>,
              fmtNum(t.balanceAfter, u === "G" ? 1 : 0),
              fmtNum(t.unitCost, 4),
              t.refType === "SalesOrder" ? <A key="r" href={`/orders/${t.refId}`}>訂單</A> : t.refType === "RoastBatch" ? <A key="r" href={`/roasting/${t.refId}`}>烘焙</A> : t.refType === "ProductionOrder" ? <A key="r" href={`/production/${t.refId}`}>分裝</A> : (t.refType ?? "—"),
              t.actor?.name ?? "系統",
              t.note ?? "—",
              <code key="id" className="text-[10px] text-muted">{t.id.slice(0, 8)}</code>,
              !t.reversedBy && ([...MANUAL_TX_TYPES, "RECEIPT"] as string[]).includes(t.type) ? (
                <ActionDialog key="rv" label="沖銷" size="sm" variant="ghost" title="沖銷此交易？" description="將建立一筆反向交易，原交易保留於帳本。" payload={{ txId: t.id }} fields={[{ name: "note", label: "沖銷原因", required: true }]} action={reverseTx} />
              ) : (
                ""
              ),
            ])}
          />
        </Card>
        <Card>
          <CardHeader title="保留紀錄" description="訂單保留成品／分裝預留熟豆；狀態變更保留歷史" />
          <SimpleTable
            head={["建立", "用途", "數量", "狀態", "對象", "釋放／使用時間"]}
            rows={lot.reservations.map((r) => [
              fmtDateTime(r.createdAt),
              r.purpose === "ORDER" ? "訂單保留" : "分裝預留",
              q(r.quantity),
              r.status === "ACTIVE" ? <Badge key="s" tone="warning">保留中</Badge> : r.status === "CONSUMED" ? <Badge key="s" tone="sage">已使用</Badge> : <Badge key="s">已釋放</Badge>,
              r.salesOrderItem ? <A key="o" href={`/orders/${r.salesOrderItem.orderId}`}>{r.salesOrderItem.order.orderNo}</A> : r.productionOrder ? <A key="p" href={`/production/${r.productionOrder.id}`}>{r.productionOrder.orderNo}</A> : "—",
              fmtDateTime(r.consumedAt ?? r.releasedAt),
            ])}
            empty="無保留紀錄"
          />
        </Card>
      </div>
    </>
  );
}
