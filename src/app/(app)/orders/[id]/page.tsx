import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D, fmtMoney, fmtMoney2, fmtNum } from "@/lib/decimal";
import { fmtDateTime, fmtDbDate } from "@/lib/time";
import { COST_CATEGORY, FULFILL, PAYMENT, PAYMENT_METHOD, PROD_STATUS } from "@/lib/labels";
import { traceOrder } from "@/server/domain/traceability";
import { ActionDialog } from "@/components/action-dialog";
import { StatusBadge } from "@/components/status";
import { A, Badge, Card, CardBody, CardHeader, KV, Notice, PageHeader, SimpleTable } from "@/components/ui";
import { cancelAction, completeAction, confirmPaymentAction, inspectAction, markPendingAction, orderCostAction, refundAction, returnAction, shipAction } from "../actions";

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await prisma.salesOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      items: { include: { allocations: { include: { lot: true, variant: true, returnItems: true } }, productionOrders: true } },
      payments: { orderBy: { occurredAt: "asc" } },
      shipment: true,
      returns: { include: { items: { include: { allocation: { include: { lot: true, variant: true } } } } }, orderBy: { createdAt: "desc" } },
      costEntries: true,
    },
  });
  if (!o) notFound();
  const trace = await traceOrder(o.id);
  const preShip = ["PENDING", "AWAITING_PACKAGING", "READY_TO_SHIP"].includes(o.fulfillmentStatus);
  const shippedAllocs = o.items.flatMap((it) => it.allocations.filter((a) => a.status === "SHIPPED").map((a) => ({ ...a, returned: a.returnItems.reduce((s, r) => s.add(r.quantity), D(0)) })));
  const returnable = shippedAllocs.filter((a) => D(a.quantity).gt(a.returned));
  const cogs = o.items.reduce((s, it) => s.add(it.costSnapshot ?? 0), D(0));
  const directCosts = o.costEntries.reduce((s, c) => s.add(c.amount), D(0));
  const netSales = o.items.reduce((s, it) => s.add(o.taxMode === "INCLUSIVE" ? D(it.lineTotal).sub(it.taxAmount) : it.lineTotal), D(0));

  return (
    <>
      <PageHeader
        title={`訂單 ${o.orderNo}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge map={PAYMENT} value={o.paymentStatus} />
            <StatusBadge map={FULFILL} value={o.fulfillmentStatus} />
            <span>{fmtDateTime(o.orderedAt)}</span>
            {o.channel !== "MANUAL" && <Badge tone="info">{o.channel === "WEB" ? "官網" : "其他通路"}</Badge>}
          </span>
        }
        back={{ href: "/orders", label: "訂單管理" }}
        actions={
          <>
            {o.paymentStatus === "UNPAID" && o.fulfillmentStatus !== "CANCELLED" && (
              <ActionDialog label="標記待確認" variant="outline" title="顧客已回報匯款" payload={{ orderId: o.id }} fields={[{ name: "reference", label: "匯款資訊（例：末五碼）" }]} action={markPendingAction} />
            )}
            {["UNPAID", "PENDING_CONFIRMATION"].includes(o.paymentStatus) && o.fulfillmentStatus !== "CANCELLED" && (
              <ActionDialog
                label="確認匯款"
                title={`確認收到 ${fmtMoney(o.total)}`}
                description="付款確認不會異動庫存；重複確認不會重複記錄。"
                payload={{ orderId: o.id }}
                fields={[
                  { name: "method", label: "付款方式", type: "select", options: Object.entries(PAYMENT_METHOD).map(([value, label]) => ({ value, label })) },
                  { name: "reference", label: "匯款參考（末五碼等）" },
                  { name: "note", label: "備註" },
                ]}
                action={confirmPaymentAction}
              />
            )}
            {o.fulfillmentStatus === "READY_TO_SHIP" && (
              <ActionDialog
                label="標記出貨"
                title="出貨"
                description={o.paymentStatus !== "PAID" ? "⚠ 訂單尚未確認付款，依系統設定將無法出貨。" : "將扣除已保留的成品庫存（出貨扣帳）。"}
                payload={{ orderId: o.id }}
                fields={[
                  { name: "method", label: "配送方式", defaultValue: o.shippingMethod ?? "" },
                  { name: "carrier", label: "物流商" },
                  { name: "trackingNo", label: "追蹤號碼" },
                  { name: "shippingCost", label: "實際物流成本（TWD）", type: "number" },
                  { name: "note", label: "出貨備註" },
                ]}
                action={shipAction}
              />
            )}
            {o.fulfillmentStatus === "SHIPPED" && <ActionDialog label="標記完成" variant="outline" title="標記訂單完成？" payload={{ orderId: o.id }} action={completeAction} />}
            {returnable.length > 0 && (
              <ActionDialog
                label="辦理退貨"
                variant="outline"
                title="建立退貨"
                description={`退回商品先進入待檢庫存，不會直接恢復可售。格式：批次ID:數量。可退：${returnable.map((a) => `${a.variant.sku}/${a.lot.lotCode} 最多 ${D(a.quantity).sub(a.returned)}`).join("；")}`}
                payload={{ orderId: o.id }}
                fields={[
                  { name: "items", label: "退貨品項", type: "textarea", required: true, defaultValue: returnable.map((a) => `${a.id}:${D(a.quantity).sub(a.returned)}`).join(","), hint: "預設為全部可退數量，可修改數量" },
                  { name: "reason", label: "退貨原因" },
                ]}
                action={returnAction}
              />
            )}
            {["PAID", "PARTIALLY_REFUNDED"].includes(o.paymentStatus) && !preShip && (
              <ActionDialog label="記錄退款" variant="ghost" title="記錄退款" payload={{ orderId: o.id }} fields={[{ name: "amount", label: "退款金額", type: "number", required: true }, { name: "reference", label: "參考資訊" }, { name: "note", label: "備註" }]} action={refundAction} />
            )}
            {preShip && (
              <ActionDialog
                label="取消訂單"
                variant="danger"
                title="取消訂單？"
                description="將釋放所有保留量、取消未完成的接單後分裝單；歷史紀錄保留。"
                payload={{ orderId: o.id }}
                fields={[
                  { name: "reason", label: "取消原因" },
                  ...(o.paymentStatus === "PAID" ? [{ name: "refundAmount", label: "同時記錄退款金額", type: "number" as const, defaultValue: o.total.toString() }] : []),
                ]}
                action={cancelAction}
              />
            )}
          </>
        }
      />
      <div className="grid gap-6">
        {o.fulfillmentStatus === "AWAITING_PACKAGING" && (
          <Notice tone="warning">
            此訂單有接單後分裝的品項：
            {o.items.flatMap((it) => it.productionOrders).filter((p) => p.status === "PLANNED").map((p) => (
              <A key={p.id} href={`/production/${p.id}`}>
                {" "}
                {p.orderNo}
              </A>
            ))}
            ，完成分裝後會自動分配並轉為「可出貨」。
          </Notice>
        )}
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="訂單明細" description="單價、商品名稱與成本均為快照，不隨日後價格變動" />
            <SimpleTable
              head={["SKU", "商品", "數量", "單價", "折扣", "小計", "稅額", "成本快照", "履約方式"]}
              rows={o.items.map((it) => [
                it.skuSnapshot,
                it.nameSnapshot,
                it.quantity,
                fmtMoney(it.unitPriceSnapshot),
                fmtMoney(it.discount),
                fmtMoney(it.lineTotal),
                fmtMoney2(it.taxAmount),
                fmtMoney2(it.costSnapshot),
                it.fulfillmentMode === "MADE_TO_ORDER" ? <Badge key="m" tone="warning">接單後分裝</Badge> : it.fulfillmentMode === "NOT_TRACKED" ? "不追蹤" : it.isBundle ? "套組現貨" : "現貨",
              ])}
            />
            <CardBody className="border-t border-border">
              <KV
                cols={4}
                items={[
                  ["商品小計", fmtMoney(o.subtotal)],
                  ["折扣合計", fmtMoney(o.discountTotal)],
                  [`稅額（${o.taxMode === "INCLUSIVE" ? "內含" : o.taxMode === "EXCLUSIVE" ? "外加" : "不計"} ${fmtNum(D(o.taxRate).mul(100), 1)}%）`, fmtMoney2(o.taxTotal)],
                  ["運費收入", fmtMoney(o.shippingFee)],
                  ["訂單總額", <b key="t">{fmtMoney(o.total)}</b>],
                  ["已退款", fmtMoney(o.refundedTotal)],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="顧客與配送" />
            <CardBody>
              <KV
                cols={2}
                items={[
                  ["顧客", o.customer ? <A key="c" href={`/customers/${o.customer.id}`}>{o.customerName}</A> : o.customerName],
                  ["電話", o.customerPhone],
                  ["Email", o.customerEmail],
                  ["地址", o.shippingAddress],
                  ["配送方式", o.shipment?.method ?? o.shippingMethod],
                  ["物流商", o.shipment?.carrier],
                  ["追蹤號碼", o.shipment?.trackingNo],
                  ["出貨時間", fmtDateTime(o.shipment?.shippedAt)],
                  ["備註", <span key="n" className="whitespace-pre-line">{o.note ?? "—"}</span>],
                ]}
              />
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="庫存批次分配" description="出貨時依此明確分配的批次扣帳" />
          <SimpleTable
            head={["SKU", "成品批次", "數量", "每件成本", "狀態"]}
            rows={o.items.flatMap((it) =>
              it.allocations.map((a) => [
                a.variant.sku,
                <A key="l" href={`/inventory/lots/${a.lotId}`}>{a.lot.lotCode}</A>,
                fmtNum(a.quantity, 0),
                fmtMoney2(a.unitCost),
                a.status === "RESERVED" ? <Badge key="s" tone="warning">已保留</Badge> : a.status === "SHIPPED" ? <Badge key="s" tone="sage">已出貨</Badge> : <Badge key="s">已釋放</Badge>,
              ]),
            )}
            empty="尚未分配批次"
          />
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="付款紀錄" />
            <SimpleTable head={["時間", "類型", "方式", "金額", "參考"]} rows={o.payments.map((p) => [fmtDateTime(p.occurredAt), p.type === "PAYMENT" ? "付款" : "退款", PAYMENT_METHOD[p.method], fmtMoney(p.amount), p.reference ?? "—"])} empty="尚無付款紀錄" />
          </Card>
          <Card>
            <CardHeader
              title="訂單損益（管理用）"
              description="銷貨毛利 = 商品淨額 − COGS；訂單貢獻 = 毛利 + 運費收入 − 訂單直接成本 − 退款"
              action={
                <ActionDialog
                  label="＋ 直接成本"
                  size="sm"
                  variant="ghost"
                  title="新增訂單直接成本"
                  payload={{ orderId: o.id }}
                  fields={[
                    { name: "category", label: "類別", type: "select", options: ["SHIPPING", "PLATFORM_FEE", "PAYMENT_FEE", "ORDER_OTHER"].map((c) => ({ value: c, label: COST_CATEGORY[c] })) },
                    { name: "amount", label: "金額", type: "number", required: true },
                    { name: "isEstimate", label: "成本性質", type: "select", options: [{ value: "false", label: "實際" }, { value: "true", label: "估計" }] },
                    { name: "calcNote", label: "計算方式" },
                  ]}
                  action={orderCostAction}
                />
              }
            />
            <SimpleTable
              head={["項目", "金額"]}
              rows={[
                ["商品銷售淨額（未稅）", fmtMoney2(netSales)],
                ["銷貨成本 COGS（批次快照）", fmtMoney2(cogs)],
                [<b key="g">銷貨毛利</b>, <b key="v">{fmtMoney2(netSales.sub(cogs))}</b>],
                ["運費收入", fmtMoney2(o.shippingFee)],
                ...o.costEntries.map((c) => [`${COST_CATEGORY[c.category]}${c.isEstimate ? "（估計）" : ""}`, `− ${fmtMoney2(c.amount)}`]),
                ["退款", `− ${fmtMoney2(o.refundedTotal)}`],
                [<b key="c">訂單貢獻利益</b>, <b key="v">{fmtMoney2(netSales.sub(cogs).add(o.shippingFee).sub(directCosts).sub(o.refundedTotal))}</b>],
              ]}
            />
          </Card>
        </div>

        {o.returns.length > 0 && (
          <Card>
            <CardHeader title="退貨" description="待檢庫存不計入可售；檢查後選擇重新入庫或報廢" />
            <SimpleTable
              head={["退貨單", "SKU／原批次", "數量", "原因", "狀態", ""]}
              rows={o.returns.flatMap((r) =>
                r.items.map((ri) => [
                  r.returnNo,
                  `${ri.allocation.variant.sku}／${ri.allocation.lot.lotCode}`,
                  fmtNum(ri.quantity, 0),
                  r.reason ?? "—",
                  ri.disposition === "RESTOCK" ? <Badge key="s" tone="sage">已重新入庫</Badge> : ri.disposition === "SCRAP" ? <Badge key="s">已報廢</Badge> : <Badge key="s" tone="danger">待檢</Badge>,
                  !ri.disposition ? (
                    <span key="a" className="flex gap-1">
                      <ActionDialog label="合格入庫" size="sm" variant="outline" title="檢查合格，重新入庫？" payload={{ returnItemId: ri.id, disposition: "RESTOCK" }} fields={[{ name: "note", label: "檢查備註" }]} action={inspectAction} />
                      <ActionDialog label="報廢" size="sm" variant="ghost" title="檢查不合格，報廢？" payload={{ returnItemId: ri.id, disposition: "SCRAP" }} fields={[{ name: "note", label: "原因" }]} action={inspectAction} />
                    </span>
                  ) : (
                    fmtDateTime(ri.inspectedAt)
                  ),
                ]),
              )}
            />
          </Card>
        )}

        <Card>
          <CardHeader title="批次追溯" description="訂單 → SKU → 包裝批次 → 烘焙批次 → 生豆採購批次（不含顧客個資）" />
          <CardBody className="space-y-3">
            {trace.order.items.flatMap((it) =>
              it.allocations.map((a, i) => {
                const pb = a.lot.packagingBatch;
                const po = pb?.productionOrder;
                const rb = po?.sourceLot.roastBatch;
                const gl = rb?.greenLot;
                return (
                  <div key={`${it.skuSnapshot}-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-bg p-3 text-sm">
                    <Badge tone="primary">{a.variant.sku} × {fmtNum(a.quantity, 0)}</Badge>→
                    <span>包裝 {pb?.batchNo ?? "—"}（{fmtDateTime(pb?.packagedAt)}，每件 {fmtMoney2(a.unitCost)}）</span>→
                    <span>烘焙 {rb?.batchNo ?? "—"}（失重 {fmtNum(rb?.weightLossPercent, 1)}%）</span>→
                    <span>
                      生豆 {gl?.lotCode ?? "—"}（{gl?.coffee.nameZh}，採購 {gl?.purchase.purchaseNo}／{fmtDbDate(gl?.purchase.purchaseDate)}，{fmtMoney2(gl?.costPerG)}/g）
                    </span>
                  </div>
                );
              }),
            )}
            {trace.checks.map((c) => (
              <p key={c.sku} className="text-xs text-muted">
                {c.sku}：訂購 {c.ordered}、已分配 {c.allocated} {Number(c.allocated) === c.ordered || o.items.find((x) => x.skuSnapshot === c.sku)?.isBundle ? "✓" : "（尚未全數分配）"}
              </p>
            ))}
            {o.items.some((it) => it.productionOrders.length) && (
              <p className="text-xs text-muted">
                接單後分裝單：
                {o.items.flatMap((it) => it.productionOrders).map((p) => (
                  <span key={p.id} className="ml-2">
                    <A href={`/production/${p.id}`}>{p.orderNo}</A> <StatusBadge map={PROD_STATUS} value={p.status} />
                  </span>
                ))}
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
