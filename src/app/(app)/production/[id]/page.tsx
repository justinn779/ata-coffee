import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D, fmtGrams, fmtMoney2, fmtNum } from "@/lib/decimal";
import { fmtDateTime, fmtDbDate } from "@/lib/time";
import { PROD_MODE, PROD_STATUS } from "@/lib/labels";
import { ActionDialog } from "@/components/action-dialog";
import { StatusBadge } from "@/components/status";
import { A, Badge, Card, CardBody, CardHeader, KV, Notice, PageHeader, SimpleTable } from "@/components/ui";
import { cancelPO, completePO } from "../actions";

export default async function PODetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const po = await prisma.productionOrder.findUnique({
    where: { id },
    include: {
      targetVariant: { include: { product: true, materials: { include: { material: true } } } },
      sourceLot: { include: { roastBatch: { include: { greenLot: { include: { coffee: true } } } } } },
      consumptions: { include: { lot: { include: { item: true } } } },
      packagingBatch: { include: { outputLot: true, traceability: true } },
      reservations: true,
      salesOrderItem: { include: { order: true } },
      costEntries: true,
    },
  });
  if (!po) notFound();
  const need = D(po.fillWeightG).mul(po.plannedQty);
  return (
    <>
      <PageHeader
        title={`分裝單 ${po.orderNo}`}
        description={`${po.targetVariant.product.name}｜${po.targetVariant.name}（${po.targetVariant.sku}）`}
        back={{ href: "/production", label: "分裝生產" }}
        actions={
          po.status === "PLANNED" ? (
            <>
              <ActionDialog
                label="完成分裝"
                title="完成分裝"
                description={`單一交易：扣熟豆 ${fmtNum(po.fillWeightG, 1)}g × 實際數量 + 損耗、扣包材、產出成品。任何一項不足則全部回滾。`}
                payload={{ id: po.id }}
                fields={[
                  { name: "actualQty", label: "實際生產數量（件）", type: "number", required: true, defaultValue: String(po.plannedQty) },
                  { name: "lossG", label: "額外包裝損耗（g）", type: "number", defaultValue: "0" },
                  { name: "laborCost", label: "包裝人工成本（TWD，估計）", type: "number" },
                  { name: "qualityStatus", label: "品質狀態", type: "select", options: [{ value: "PASS", label: "合格（可售）" }, { value: "HOLD", label: "保留（不可售）" }] },
                  { name: "expiryDate", label: "商品標示有效日期（選填）", type: "date", hint: "留空沿用熟豆批次之保存期限設定" },
                  { name: "note", label: "備註", type: "textarea" },
                ]}
                action={completePO}
              />
              {!po.salesOrderItem && <ActionDialog label="取消" variant="ghost" title="取消分裝單？" description="將釋放已預留的熟豆。" payload={{ id: po.id }} fields={[{ name: "reason", label: "原因" }]} action={cancelPO} />}
            </>
          ) : null
        }
      />
      <div className="grid gap-6">
        {po.salesOrderItem && (
          <Notice tone="warning">
            接單後分裝：完成後成品將自動分配給訂單 <A href={`/orders/${po.salesOrderItem.orderId}`}>{po.salesOrderItem.order.orderNo}</A>。
          </Notice>
        )}
        <Card>
          <CardHeader title="生產資訊" action={<StatusBadge map={PROD_STATUS} value={po.status} />} />
          <CardBody>
            <KV
              cols={4}
              items={[
                ["類型", PROD_MODE[po.mode]],
                ["熟豆批次", <A key="l" href={`/inventory/lots/${po.sourceLotId}`}>{po.sourceLot.lotCode}</A>],
                ["烘焙批次", po.sourceLot.roastBatch ? <A key="r" href={`/roasting/${po.sourceLot.roastBatch.id}`}>{po.sourceLot.roastBatch.batchNo}</A> : "—"],
                ["咖啡豆", po.sourceLot.roastBatch?.greenLot.coffee.nameZh],
                ["預計數量", `${po.plannedQty} 件`],
                ["實際數量", po.actualQty != null ? `${po.actualQty} 件` : "—"],
                ["單包重量", `${fmtNum(po.fillWeightG, 2)} g`],
                ["熟豆預留", po.status === "PLANNED" ? fmtGrams(need, 1) : "已使用／已釋放"],
                ["耗用熟豆", po.beansConsumedG ? fmtGrams(po.beansConsumedG, 1) : "—"],
                ["損耗", po.lossG ? fmtGrams(po.lossG, 1) : "—"],
                ["生產日期", fmtDbDate(po.plannedDate)],
                ["完成時間", fmtDateTime(po.completedAt)],
                ["品質狀態", po.qualityStatus === "PASS" ? "合格" : po.qualityStatus === "HOLD" ? "保留" : "不合格"],
                ["備註", po.note],
              ]}
            />
          </CardBody>
        </Card>
        {po.packagingBatch && (
          <Card>
            <CardHeader title={`包裝批次 ${po.packagingBatch.batchNo}`} description="成品批次可追溯至烘焙批次與生豆採購批次" />
            <CardBody>
              <KV
                cols={4}
                items={[
                  ["成品批次", po.packagingBatch.outputLot ? <A key="o" href={`/inventory/lots/${po.packagingBatch.outputLot.id}`}>{po.packagingBatch.outputLot.lotCode}</A> : "—"],
                  ["總成本", fmtMoney2(po.packagingBatch.totalCost)],
                  ["每件成本", fmtMoney2(po.packagingBatch.unitCost)],
                  ["有效日期", po.packagingBatch.expiryDate ? `${fmtDbDate(po.packagingBatch.expiryDate)}（${po.packagingBatch.expirySource}）` : "未設定"],
                  ["QR 履歷", po.packagingBatch.traceability ? <span key="t">{po.packagingBatch.traceability.isPublished ? <A href={`/t/${po.packagingBatch.traceability.publicCode}`}>/t/{po.packagingBatch.traceability.publicCode}</A> : <Badge>未發布</Badge>}</span> : "—"],
                ]}
              />
            </CardBody>
          </Card>
        )}
        <Card>
          <CardHeader title={po.status === "COMPLETED" ? "實際耗用與成本計算" : "包材需求（每件）"} />
          {po.status === "COMPLETED" ? (
            <SimpleTable
              head={["類別", "批次", "數量", "單位成本", "小計"]}
              rows={[
                ...po.consumptions.map((c) => [{ BEANS: "熟豆", LOSS: "分裝損耗", MATERIAL: "包材" }[c.kind], <A key="l" href={`/inventory/lots/${c.lotId}`}>{c.lot.lotCode}</A>, c.lot.item.unit === "G" ? fmtGrams(c.quantity, 1) : `${fmtNum(c.quantity, 0)} 件`, fmtMoney2(c.unitCost), fmtMoney2(c.totalCost)]),
                ...po.costEntries.map((c) => ["包裝人工" + (c.isEstimate ? "（估計）" : ""), "—", "—", "—", fmtMoney2(c.amount)]),
                [<b key="t">合計</b>, "", "", "", <b key="v">{fmtMoney2(po.packagingBatch?.totalCost)}</b>],
              ]}
            />
          ) : (
            <SimpleTable head={["包材", "每件用量", `計畫需求（× ${po.plannedQty}）`]} rows={po.targetVariant.materials.map((m) => [m.material.name, fmtNum(m.quantityPerUnit, 2), fmtNum(D(m.quantityPerUnit).mul(po.plannedQty), 0)])} empty="此 SKU 未設定包材 BOM" />
          )}
        </Card>
      </div>
    </>
  );
}
