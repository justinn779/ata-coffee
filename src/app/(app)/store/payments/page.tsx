"use client";

import { useState } from "react";
import { useCol } from "@/lib/data";
import { callOp } from "@/lib/api";
import { fmtDateTime } from "@/lib/time";
import { fmtMoney } from "@/lib/decimal";
import { ActionDialog } from "@/components/action-dialog";
import { Badge, Card, CardHeader, Notice, PageHeader, SimpleTable, A } from "@/components/ui";
import { PAY_LABEL } from "../_shared";

/**
 * 付款人工對帳：顧客回報帳號末五碼 → 管理員確認銀行實際入帳後才轉為已付款。
 * 已回報但逾期的訂單不會被自動取消，會出現在這裡等人工確認。
 */
export default function Payments() {
  const [tab, setTab] = useState<"todo" | "unpaid" | "issue">("todo");
  const orders = useCol("orders", [["channel", "STORE"]], "orderedAt");
  const reports = useCol("paymentReports", [], "createdAt");
  const latest = new Map<string, Record<string, unknown>>();
  for (const r of reports.data) if (!latest.has(r.orderId)) latest.set(r.orderId, r);
  const o = orders.data;
  const list =
    tab === "todo"
      ? o.filter((x) => ["PENDING_CONFIRMATION", "UNDER_REVIEW"].includes(x.paymentStatus))
      : tab === "unpaid"
        ? o.filter((x) => x.paymentStatus === "UNPAID" && x.fulfillmentStatus !== "CANCELLED")
        : o.filter((x) => ["REJECTED", "EXPIRED", "REFUND_PENDING"].includes(x.paymentStatus) || (x.store?.needsReview && x.paymentStatus !== "PAID"));
  return (
    <>
      <PageHeader title="付款對帳" description="確認銀行實際收到款項後才按「確認收款」；末五碼只是顧客的回報" />
      <div className="mb-4 flex gap-2">
        {(
          [
            ["todo", "待對帳"],
            ["unpaid", "未付款"],
            ["issue", "異常／逾期／待退款"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`h-9 rounded-lg px-3 text-sm ${tab === k ? "bg-primary text-primary-fg" : "border border-border"}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === "issue" && <Notice tone="info">重複付款、金額不符、找不到訂單的匯款：在訂單頁用「記錄退款」或備註處理；退款請人工轉帳後再記錄。</Notice>}
      <Card className="mt-4">
        <CardHeader title={`${list.length} 筆`} />
        <SimpleTable
          head={["訂單", "顧客", "應付", "回報末五碼", "回報時間", "付款期限", "狀態", "操作"]}
          rows={list.map((x) => {
            const r = latest.get(x.id) as { last5?: string; createdAt?: string; amount?: string; lateAfterDeadline?: boolean } | undefined;
            return [
              <A key="o" href={`/orders/view/?id=${x.id}`}>
                {x.orderNo}
              </A>,
              x.customerName,
              fmtMoney(x.total),
              r?.last5 ? <span className="font-mono">{r.last5}</span> : "—",
              r?.createdAt ? fmtDateTime(r.createdAt) : "—",
              <span key="d" className={x.store?.paymentDeadline < new Date().toISOString() ? "text-danger" : ""}>
                {fmtDateTime(x.store?.paymentDeadline)}
              </span>,
              <span key="s" className="flex flex-wrap gap-1">
                <Badge tone={x.paymentStatus === "PAID" ? "sage" : x.paymentStatus === "REJECTED" || x.paymentStatus === "EXPIRED" ? "danger" : "warning"}>{PAY_LABEL[x.paymentStatus] ?? x.paymentStatus}</Badge>
                {x.store?.needsReview && <Badge tone="danger">逾期待確認</Badge>}
                {r?.lateAfterDeadline && <Badge tone="danger">逾期後回報</Badge>}
              </span>,
              <span key="a" className="flex flex-wrap gap-1">
                {x.paymentStatus !== "PAID" && (
                  <ActionDialog
                    label="確認收款"
                    size="sm"
                    title={`確認收款 ${x.orderNo}`}
                    description={`請先在銀行確認已收到 ${fmtMoney(x.total)}${r?.last5 ? `（末五碼 ${r.last5}）` : ""}。確認後會通知顧客並開始備貨。`}
                    fields={[
                      { name: "amount", label: "實收金額", type: "number", defaultValue: String(Number(x.total)) },
                      { name: "reference", label: "對帳備註", defaultValue: r?.last5 ? `末五碼 ${r.last5}` : "" },
                    ]}
                    payload={{ orderId: x.id }}
                    action={(i) => callOp("order.confirmPayment", i)}
                    successMessage="已確認收款"
                  />
                )}
                {["PENDING_CONFIRMATION", "UNDER_REVIEW"].includes(x.paymentStatus) && (
                  <ActionDialog label="退回" size="sm" variant="outline" title={`付款回報有誤 ${x.orderNo}`} description="會寄信請顧客確認後重新回報。" fields={[{ name: "reason", label: "原因（顧客會看到）", required: true, defaultValue: "查無此筆匯款，請確認末五碼與金額" }]} payload={{ id: x.id }} action={(i) => callOp("store.payment.reject", i)} successMessage="已通知顧客" />
                )}
                {x.paymentStatus === "PENDING_CONFIRMATION" && <ActionDialog label="標記查核中" size="sm" variant="ghost" title="標記對帳查核中" fields={[{ name: "note", label: "備註" }]} payload={{ id: x.id, to: "UNDER_REVIEW" }} action={(i) => callOp("store.payment.status", i)} successMessage="已標記" />}
                {["PAID", "EXPIRED", "UNDER_REVIEW"].includes(x.paymentStatus) && <ActionDialog label="待退款" size="sm" variant="ghost" title="標記待退款" description="退款請人工轉帳，完成後在訂單頁「記錄退款」。" fields={[{ name: "note", label: "原因" }]} payload={{ id: x.id, to: "REFUND_PENDING" }} action={(i) => callOp("store.payment.status", i)} successMessage="已標記待退款" />}
              </span>,
            ];
          })}
          empty="沒有需要處理的付款"
        />
      </Card>
    </>
  );
}

