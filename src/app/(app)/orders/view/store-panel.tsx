"use client";

import { useCol, type Row } from "@/lib/data";
import { opAction } from "@/lib/api";
import { fmtDateTime } from "@/lib/time";
import { fmtMoney } from "@/lib/decimal";
import { FULFILL, PAYMENT } from "@/lib/labels";
import { ActionDialog } from "@/components/action-dialog";
import { Badge, Card, CardBody, CardHeader, KV, Notice, SimpleTable } from "@/components/ui";

const SHIP_NEXT: Record<string, Array<[string, string]>> = {
  SHIPPED: [
    ["ARRIVED", "已到店"],
    ["LOGISTICS_ISSUE", "物流異常"],
    ["RETURNED_UNCLAIMED", "未取退回"],
  ],
  ARRIVED: [
    ["PICKED_UP", "已取貨"],
    ["RETURNED_UNCLAIMED", "未取退回"],
    ["LOGISTICS_ISSUE", "物流異常"],
  ],
  LOGISTICS_ISSUE: [
    ["SHIPPED", "恢復配送中"],
    ["ARRIVED", "已到店"],
    ["RETURNED_UNCLAIMED", "未取退回"],
  ],
};
const FIELD: Record<string, string> = { orderStatus: "訂單", paymentStatus: "付款", fulfillmentStatus: "履約" };
const stLabel = (field: string, v: unknown) => (v == null ? "—" : v === "CREATED" ? "成立" : ((field === "paymentStatus" ? PAYMENT : FULFILL)[String(v)]?.[0] ?? String(v)));

/** 商城訂單專屬資訊：取貨門市、付款期限與回報、優惠、物流狀態、預購分配、狀態歷史、通知寄送 */
export function StorePanel({ order: x }: { order: Row }) {
  const st = x.store ?? {};
  const reports = useCol("paymentReports", [["orderId", x.id]], "createdAt");
  const events = useCol("orderEvents", [["orderId", x.id]], "at");
  const mails = useCol("notifyOutbox", [["orderId", x.id]], "createdAt");
  const items = useCol("orderItems", [["orderId", x.id]]);
  const hasPreorder = items.data.some((i) => i.fulfillmentMode === "PREORDER");
  const pk = st.pickup ?? {};
  return (
    <Card>
      <CardHeader
        title="商城訂單"
        action={
          <span className="flex flex-wrap gap-2">
            {hasPreorder && x.fulfillmentStatus !== "CANCELLED" && <ActionDialog label="分配預購商品" size="sm" title="預購到貨：分配商品" description="用可用的成品（不足時建立接單後分裝，單一熟豆批次）分配給預購明細，之後與現貨一起出貨。" payload={{ orderId: x.id }} action={opAction("store.preorder.allocate")} successMessage="已分配" />}
            {SHIP_NEXT[x.fulfillmentStatus] && (
              <ActionDialog
                label="更新物流狀態"
                size="sm"
                variant="outline"
                title="更新物流狀態"
                fields={[
                  { name: "status", label: "新狀態", type: "select", options: SHIP_NEXT[x.fulfillmentStatus].map(([value, label]) => ({ value, label })), required: true },
                  { name: "trackingNo", label: "物流單號（選填）", defaultValue: x.shipment?.trackingNo ?? "" },
                  { name: "note", label: "備註" },
                ]}
                payload={{ id: x.id }}
                action={opAction("store.shipment")}
                successMessage="已更新，已通知顧客"
              />
            )}
            <ActionDialog label="撤銷訂單連結" size="sm" variant="ghost" title="撤銷顧客的訂單連結" description="訂單連結外流時使用。顧客之後要用訂單編號＋Email 驗證碼重新查詢。" payload={{ id: x.id }} action={opAction("store.access.revoke")} successMessage="已撤銷" />
          </span>
        }
      />
      <CardBody className="grid gap-4">
        {st.needsReview && x.paymentStatus !== "PAID" && <Notice tone="danger">付款期限已過，但顧客有回報付款：系統不會自動取消，請確認是否收到款項。</Notice>}
        <KV
          cols={4}
          items={[
            ["取貨門市", `${pk.carrierLabel ?? ""} ${pk.storeName ?? ""}（${pk.storeId ?? ""}）`],
            ["門市來源", pk.verified ? "已驗證" : "顧客填寫（人工確認）"],
            ["付款期限", fmtDateTime(st.paymentDeadline)],
            ["預計出貨", st.estShipDate !== st.originalEstShipDate ? `${st.estShipDate}（原 ${st.originalEstShipDate}）` : (st.estShipDate ?? "—")],
            ["商品原價小計", fmtMoney(st.itemsGross)],
            ["優惠", (st.promotions ?? []).map((p: { name: string; amount: string }) => `${p.name} −${p.amount}`).join("、") || "—"],
            ["收款帳戶（下單當時）", st.bank ? `${st.bank.bankCode} ${st.bank.accountNo}${st.bank.isDemo ? "（示範）" : ""}` : "—"],
            ["會員", x.customerUid ? "會員訂單" : "訪客訂單"],
          ]}
        />
        <div>
          <h3 className="mb-2 text-sm font-medium">付款回報</h3>
          <SimpleTable head={["時間", "末五碼", "狀態", "說明"]} rows={reports.data.map((r) => [fmtDateTime(r.createdAt), <span key="l" className="font-mono">{r.last5}</span>, <Badge key="s" tone={r.status === "ACCEPTED" ? "sage" : r.status === "PENDING" ? "warning" : "neutral"}>{({ PENDING: "待確認", ACCEPTED: "已確認", REJECTED: "已退回", SUPERSEDED: "已重新回報", CLOSED: "已關閉" } as Record<string, string>)[r.status] ?? r.status}</Badge>, [r.lateAfterDeadline ? "逾期後回報" : "", r.rejectReason ?? ""].filter(Boolean).join("；") || "—"])} empty="顧客尚未回報" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium">狀態歷史</h3>
            <SimpleTable head={["時間", "項目", "變更", "操作者"]} rows={events.data.map((e) => [fmtDateTime(e.at), FIELD[e.field] ?? e.field, `${stLabel(e.field, e.from)} → ${stLabel(e.field, e.to)}`, e.actorName ?? "系統"])} empty="—" />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium">寄給顧客的通知</h3>
            <SimpleTable head={["時間", "內容", "狀態"]} rows={mails.data.map((m) => [fmtDateTime(m.createdAt), m.subject ?? m.template, <span key="s">{m.status === "SENT" ? "已寄出" : m.status === "FAILED" ? <span className="text-danger">失敗：{m.lastError}</span> : m.status === "RETRY" ? "重試中" : "待寄"}</span>])} empty="—" />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
