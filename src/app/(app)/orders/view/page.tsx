"use client";

import { D, fmtMoney, fmtMoney2, fmtNum } from "@/lib/decimal";
import { fmtDateTime, fmtDbDate } from "@/lib/time";
import { COST_CATEGORY, FULFILL, PAYMENT, PAYMENT_METHOD, PROD_STATUS } from "@/lib/labels";
import { callOp, opAction } from "@/lib/api";
import { useCol, useDocument, useOp, type Row } from "@/lib/data";
import { Guard, useQS } from "@/lib/page";
import { ActionDialog } from "@/components/action-dialog";
import { StatusBadge } from "@/components/status";
import { A, Badge, Card, CardBody, CardHeader, KV, LinkButton, Notice, PageHeader, SimpleTable } from "@/components/ui";

interface Trace {
  chains: Array<{ sku: string; quantity: string; unitCost: string; packaging: Row | null; roast: Row | null; green: Row | null }>;
  checks: Array<{ sku: string; ordered: number; allocated: string; isBundle: boolean }>;
}

export default function OrderDetail() {
  const id = useQS("id");
  const o = useDocument("orders", id);
  const items = useCol("orderItems", [["orderId", id]]);
  const allocs = useCol("allocations", [["orderId", id]], "createdAt", false);
  const pays = useCol("payments", [["orderId", id]], "occurredAt", false);
  const rets = useCol("returns", [["orderId", id]], "createdAt");
  const pos = useCol("productionOrders", [["orderId", id]]);
  const costs = useCol("costEntries", [["orderId", id]]);
  const trace = useOp<Trace>(o.data ? "order.trace" : null, { orderId: id, v: `${o.data?.fulfillmentStatus}-${allocs.data.length}` });
  return (
    <Guard loading={o.loading} error={o.error} missing={!o.data}>
      {() => {
        const x = o.data!;
        const preShip = ["PENDING", "AWAITING_PACKAGING", "READY_TO_SHIP"].includes(x.fulfillmentStatus);
        const returnable = allocs.data.filter((a) => a.status === "SHIPPED" && D(a.quantity).gt(a.returnedQty ?? 0));
        const cogs = items.data.reduce((s, it) => s.add(it.costSnapshot ?? 0), D(0));
        const direct = costs.data.reduce((s, c) => s.add(c.amount), D(0));
        const netSales = items.data.reduce((s, it) => s.add(x.taxMode === "INCLUSIVE" ? D(it.lineTotal).sub(it.taxAmount) : D(it.lineTotal)), D(0));
        return (
          <>
            <PageHeader
              title={`訂單 ${x.orderNo}`}
              description={
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge map={PAYMENT} value={x.paymentStatus} />
                  <StatusBadge map={FULFILL} value={x.fulfillmentStatus} />
                  <span>{fmtDateTime(x.orderedAt)}</span>
                  {x.channel !== "MANUAL" && <Badge tone="info">{x.channel === "WEB" ? "官網" : "其他通路"}</Badge>}
                </span>
              }
              back={{ href: "/orders/", label: "訂單管理" }}
              actions={
                <>
                  {x.paymentStatus === "UNPAID" && x.fulfillmentStatus !== "CANCELLED" && <ActionDialog label="標記待確認" variant="outline" title="顧客已回報匯款" payload={{ orderId: x.id }} fields={[{ name: "reference", label: "匯款資訊（例：末五碼）" }]} action={opAction("order.markPending")} />}
                  {["UNPAID", "PENDING_CONFIRMATION"].includes(x.paymentStatus) && x.fulfillmentStatus !== "CANCELLED" && (
                    <ActionDialog label="確認匯款" title={`確認收到 ${fmtMoney(x.total)}`} description="付款確認不會異動庫存；重複確認不會重複記錄。" payload={{ orderId: x.id }} fields={[{ name: "method", label: "付款方式", type: "select", options: Object.entries(PAYMENT_METHOD).map(([value, label]) => ({ value, label })) }, { name: "reference", label: "匯款參考（末五碼等）" }, { name: "note", label: "備註" }]} action={opAction("order.confirmPayment")} />
                  )}
                  {x.fulfillmentStatus === "READY_TO_SHIP" && (
                    <ActionDialog label="標記出貨" title="出貨" description={x.paymentStatus !== "PAID" ? "⚠ 訂單尚未確認付款，依系統設定將無法出貨。" : "將扣除已保留的成品庫存（出貨扣帳）。"} payload={{ orderId: x.id }} fields={[{ name: "method", label: "配送方式", defaultValue: x.shippingMethod ?? "" }, { name: "carrier", label: "物流商" }, { name: "trackingNo", label: "追蹤號碼" }, { name: "shippingCost", label: "實際物流成本（TWD）", type: "number" }, { name: "note", label: "出貨備註" }]} action={opAction("order.ship")} />
                  )}
                  {x.fulfillmentStatus === "SHIPPED" && <ActionDialog label="標記完成" variant="outline" title="標記訂單完成？" payload={{ orderId: x.id }} action={opAction("order.complete")} />}
                  {returnable.length > 0 && (
                    <ActionDialog
                      label="辦理退貨"
                      variant="outline"
                      title="建立退貨"
                      description="退回商品先進入待檢庫存，不會直接恢復可售。請填寫各批次退貨數量（0 表示不退）。"
                      payload={{ orderId: x.id }}
                      fields={[...returnable.map((a) => ({ name: `q_${a.id}`, label: `${a.sku}／${a.lotCode}（最多 ${D(a.quantity).sub(a.returnedQty ?? 0)}）`, type: "number" as const, defaultValue: D(a.quantity).sub(a.returnedQty ?? 0).toString() })), { name: "reason", label: "退貨原因" }]}
                      action={async (v) => callOp("order.return", { orderId: x.id, reason: v.reason, items: returnable.map((a) => ({ allocationId: a.id, quantity: String(v[`q_${a.id}`] ?? "0") })).filter((i) => Number(i.quantity) > 0) })}
                    />
                  )}
                  {["PAID", "PARTIALLY_REFUNDED"].includes(x.paymentStatus) && !preShip && <ActionDialog label="記錄退款" variant="ghost" title="記錄退款" payload={{ orderId: x.id }} fields={[{ name: "amount", label: "退款金額", type: "number", required: true }, { name: "reference", label: "參考資訊" }, { name: "note", label: "備註" }]} action={opAction("order.refund")} />}
                  {x.fulfillmentStatus !== "CANCELLED" && (
                    <LinkButton href={`/print/orders/?ids=${x.id}`} variant="outline">
                      列印出貨單
                    </LinkButton>
                  )}
                  {preShip && ["UNPAID", "PENDING_CONFIRMATION"].includes(x.paymentStatus) && (
                    <LinkButton href={`/orders/new/?edit=${x.id}`} variant="secondary">
                      修改訂單
                    </LinkButton>
                  )}
                  {preShip && <ActionDialog label="取消訂單" variant="danger" title="取消訂單？" description="將釋放所有保留量、取消未完成的接單後分裝單；歷史紀錄保留。" payload={{ orderId: x.id }} fields={[{ name: "reason", label: "取消原因" }, ...(x.paymentStatus === "PAID" ? [{ name: "refundAmount", label: "同時記錄退款金額", type: "number" as const, defaultValue: x.total }] : [])]} action={opAction("order.cancel")} />}
                </>
              }
            />
            <div className="grid gap-6">
              {x.fulfillmentStatus === "AWAITING_PACKAGING" && (
                <Notice tone="warning">
                  此訂單有接單後分裝的品項：{pos.data.filter((p) => p.status === "PLANNED").map((p) => <A key={p.id} href={`/production/view/?id=${p.id}`}>{` ${p.orderNo}`}</A>)}，完成分裝後會自動分配並轉為「可出貨」。
                </Notice>
              )}
              <div className="grid gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader title="訂單明細" description="單價、商品名稱與成本均為快照，不隨日後價格變動" />
                  <SimpleTable head={["品項編號", "商品", "數量", "單價", "折扣", "小計", "稅額", "成本快照", "履約方式"]} rows={items.data.map((it) => [it.skuSnapshot, it.nameSnapshot, it.quantity, fmtMoney(it.unitPriceSnapshot), fmtMoney(it.discount), fmtMoney(it.lineTotal), fmtMoney2(it.taxAmount), fmtMoney2(it.costSnapshot), it.fulfillmentMode === "MADE_TO_ORDER" ? <Badge key="m" tone="warning">接單後分裝</Badge> : it.fulfillmentMode === "NOT_TRACKED" ? "不追蹤" : it.isBundle ? "套組現貨" : "現貨"])} />
                  <CardBody className="border-t border-border">
                    <KV cols={4} items={[["商品小計", fmtMoney(x.subtotal)], ["折扣合計", fmtMoney(x.discountTotal)], [`稅額（${x.taxMode === "INCLUSIVE" ? "內含" : x.taxMode === "EXCLUSIVE" ? "外加" : "不計"} ${fmtNum(D(x.taxRate).mul(100), 1)}%）`, fmtMoney2(x.taxTotal)], ["運費收入", fmtMoney(x.shippingFee)], ["訂單總額", <b key="t">{fmtMoney(x.total)}</b>], ["已退款", fmtMoney(x.refundedTotal)]]} />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="顧客與配送" />
                  <CardBody>
                    <KV cols={2} items={[["顧客", x.customerId ? <A key="c" href={`/customers/view/?id=${x.customerId}`}>{x.customerName}</A> : x.customerName], ["電話", x.customerPhone], ["Email", x.customerEmail], ["地址", x.shippingAddress], ["配送方式", x.shipment?.method ?? x.shippingMethod], ["物流商", x.shipment?.carrier], ["追蹤號碼", x.shipment?.trackingNo], ["出貨時間", fmtDateTime(x.shipment?.shippedAt)], ["備註", <span key="n" className="whitespace-pre-line">{[x.note, x.cancelReason && `取消原因：${x.cancelReason}`].filter(Boolean).join("\n") || "—"}</span>]]} />
                  </CardBody>
                </Card>
              </div>
              <Card>
                <CardHeader title="庫存批次分配" description="出貨時依此明確分配的批次扣帳" />
                <SimpleTable head={["品項編號", "成品批次", "數量", "每件成本", "狀態"]} rows={allocs.data.map((a) => [a.sku, <A key="l" href={`/inventory/lot/?id=${a.lotId}`}>{a.lotCode}</A>, fmtNum(a.quantity, 0), fmtMoney2(a.unitCost), a.status === "RESERVED" ? <Badge key="s" tone="warning">已保留</Badge> : a.status === "SHIPPED" ? <Badge key="s" tone="sage">已出貨</Badge> : <Badge key="s">已釋放</Badge>])} empty="尚未分配批次" />
              </Card>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader title="付款紀錄" />
                  <SimpleTable head={["時間", "類型", "方式", "金額", "參考"]} rows={pays.data.map((p) => [fmtDateTime(p.occurredAt), p.type === "PAYMENT" ? "付款" : "退款", PAYMENT_METHOD[p.method], fmtMoney(p.amount), p.reference ?? "—"])} empty="尚無付款紀錄" />
                </Card>
                <Card>
                  <CardHeader
                    title="訂單損益（管理用）"
                    description="銷貨毛利 = 商品淨額 − COGS；訂單貢獻 = 毛利 + 運費收入 − 訂單直接成本 − 退款"
                    action={<ActionDialog label="＋ 直接成本" size="sm" variant="ghost" title="新增訂單直接成本" payload={{ orderId: x.id }} fields={[{ name: "category", label: "類別", type: "select", options: ["SHIPPING", "PLATFORM_FEE", "PAYMENT_FEE", "ORDER_OTHER"].map((c) => ({ value: c, label: COST_CATEGORY[c] })) }, { name: "amount", label: "金額", type: "number", required: true }, { name: "isEstimate", label: "成本性質", type: "select", options: [{ value: "false", label: "實際" }, { value: "true", label: "估計" }] }, { name: "calcNote", label: "計算方式" }]} action={opAction("order.addCost")} />}
                  />
                  <SimpleTable
                    head={["項目", "金額"]}
                    rows={[
                      ["商品銷售淨額（未稅）", fmtMoney2(netSales)],
                      ["銷貨成本 COGS（批次快照）", fmtMoney2(cogs)],
                      [<b key="g">銷貨毛利</b>, <b key="v">{fmtMoney2(netSales.sub(cogs))}</b>],
                      ["運費收入", fmtMoney2(x.shippingFee)],
                      ...costs.data.map((c) => [`${COST_CATEGORY[c.category]}${c.isEstimate ? "（估計）" : ""}`, `− ${fmtMoney2(c.amount)}`]),
                      ["退款", `− ${fmtMoney2(x.refundedTotal)}`],
                      [<b key="c">訂單貢獻利益</b>, <b key="v">{fmtMoney2(netSales.sub(cogs).add(x.shippingFee).sub(direct).sub(x.refundedTotal))}</b>],
                    ]}
                  />
                </Card>
              </div>
              {rets.data.length > 0 && (
                <Card>
                  <CardHeader title="退貨" description="待檢庫存不計入可售；檢查後選擇重新入庫或報廢" />
                  <SimpleTable
                    head={["退貨單", "品項編號／原批次", "數量", "原因", "狀態", ""]}
                    rows={rets.data.flatMap((r) =>
                      (r.items as Row[]).map((ri) => [
                        r.returnNo,
                        `${ri.sku}／${ri.lotCode}`,
                        fmtNum(ri.quantity, 0),
                        r.reason ?? "—",
                        ri.disposition === "RESTOCK" ? <Badge key="s" tone="sage">已重新入庫</Badge> : ri.disposition === "SCRAP" ? <Badge key="s">已報廢</Badge> : <Badge key="s" tone="danger">待檢</Badge>,
                        !ri.disposition ? (
                          <span key="a" className="flex gap-1">
                            <ActionDialog label="合格入庫" size="sm" variant="outline" title="檢查合格，重新入庫？" payload={{ returnId: r.id, itemId: ri.id, disposition: "RESTOCK" }} fields={[{ name: "note", label: "檢查備註" }]} action={opAction("order.inspectReturn")} />
                            <ActionDialog label="報廢" size="sm" variant="ghost" title="檢查不合格，報廢？" payload={{ returnId: r.id, itemId: ri.id, disposition: "SCRAP" }} fields={[{ name: "note", label: "原因" }]} action={opAction("order.inspectReturn")} />
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
                <CardHeader title="批次追溯" description="訂單 → 品項 → 包裝批次 → 烘焙批次 → 生豆採購批次（不含顧客個資）" />
                <CardBody className="space-y-3">
                  {trace.loading && <p className="text-sm text-muted">追溯計算中…</p>}
                  {trace.data?.chains.map((c, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-bg p-3 text-sm">
                      <Badge tone="primary">{c.sku} × {fmtNum(c.quantity, 0)}</Badge>→<span>包裝 {c.packaging?.batchNo ?? "—"}（{fmtDateTime(c.packaging?.packagedAt)}，每件 {fmtMoney2(c.unitCost)}）</span>→<span>烘焙 {c.roast?.batchNo ?? "—"}（失重 {fmtNum(c.roast?.weightLossPercent, 1)}%）</span>→
                      <span>生豆 {c.green?.lotCode ?? "—"}（{c.green?.coffeeName}，採購 {c.green?.purchaseNo}／{fmtDbDate(c.green?.purchaseDate)}，{fmtMoney2(c.green?.costPerG)}/g）</span>
                    </div>
                  ))}
                  {trace.data?.checks.map((c) => (
                    <p key={c.sku} className="text-xs text-muted">
                      {c.sku}：訂購 {c.ordered}、已分配 {c.allocated} {Number(c.allocated) === c.ordered || c.isBundle ? "✓" : "（尚未全數分配）"}
                    </p>
                  ))}
                  {pos.data.length > 0 && (
                    <p className="text-xs text-muted">
                      接單後分裝單：
                      {pos.data.map((p) => (
                        <span key={p.id} className="ml-2">
                          <A href={`/production/view/?id=${p.id}`}>{p.orderNo}</A> <StatusBadge map={PROD_STATUS} value={p.status} />
                        </span>
                      ))}
                    </p>
                  )}
                </CardBody>
              </Card>
            </div>
          </>
        );
      }}
    </Guard>
  );
}
