"use client";

import { useCol, type Row } from "@/lib/data";
import { Card, CardHeader, LinkButton, Notice, PageHeader, SimpleTable, StatCard, A } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";
import { fmtMoney } from "@/lib/decimal";
import { PAY_LABEL } from "./_shared";

/** 商城總覽：今天要處理的事 */
export default function StoreHome() {
  const orders = useCol("orders", [["channel", "STORE"]], "orderedAt");
  const settings = useCol("settings");
  const outbox = useCol("notifyOutbox", [["status", "FAILED"]]);
  const campaigns = useCol("preorderCampaigns", [["status", "ACTIVE"]]);
  const st: Row = settings.data.find((s) => s.id === "store") ?? { id: "store" };
  const o = orders.data;
  const toConfirm = o.filter((x) => ["PENDING_CONFIRMATION", "UNDER_REVIEW"].includes(x.paymentStatus));
  const review = o.filter((x) => x.store?.needsReview && x.paymentStatus !== "PAID");
  const ready = o.filter((x) => x.fulfillmentStatus === "READY_TO_SHIP");
  const waitingPre = o.filter((x) => x.fulfillmentStatus === "AWAITING_PACKAGING" && x.paymentStatus === "PAID");
  const demo = !st.bank || st.bank?.isDemo || st.shipping?.isDemo;
  const missingBiz = !st.business?.name || !st.business?.address;
  return (
    <>
      <PageHeader
        title="官方商城"
        description="顧客在商城下的訂單，與後台訂單、庫存、成本共用同一套資料"
        actions={
          <LinkButton href="/shop/" target="_blank" variant="outline">
            開啟商城
          </LinkButton>
        }
      />
      <div className="grid gap-4">
        {demo && <Notice tone="warning">收款帳戶或運費仍是「示範設定」。正式上線前請到「商城設定」填入正式資料。</Notice>}
        {missingBiz && <Notice tone="warning">業者名稱、地址尚未填寫（法規必要揭露），商城頁尾會顯示「待補」。</Notice>}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="待對帳" value={toConfirm.length} href="/store/payments/" tone={toConfirm.length ? "warning" : undefined} tip="顧客已回報末五碼，等你確認收款" />
          <StatCard label="逾期待人工確認" value={review.length} href="/store/payments/" tone={review.length ? "danger" : undefined} tip="付款期限已過但顧客有回報，系統不會自動取消" />
          <StatCard label="可出貨" value={ready.length} href="/orders/?f=READY_TO_SHIP" />
          <StatCard label="已付款待備貨" value={waitingPre.length} href="/orders/?f=AWAITING_PACKAGING" tip="含預購與接單後分裝" />
          <StatCard label="通知寄送失敗" value={outbox.data.length} tone={outbox.data.length ? "danger" : undefined} tip="Email 重試多次仍失敗" />
        </div>
        <Card>
          <CardHeader title="最近的商城訂單" action={<LinkButton href="/orders/" size="sm" variant="ghost">全部訂單</LinkButton>} />
          <SimpleTable
            head={["訂單", "顧客", "金額", "付款", "下單時間"]}
            rows={o.slice(0, 10).map((x) => [<A key="a" href={`/orders/view/?id=${x.id}`}>{x.orderNo}</A>, x.customerName, fmtMoney(x.total), PAY_LABEL[x.paymentStatus] ?? x.paymentStatus, fmtDateTime(x.orderedAt)])}
            empty="還沒有商城訂單"
          />
        </Card>
        <Card>
          <CardHeader title="進行中的預購" action={<LinkButton href="/store/preorders/" size="sm" variant="ghost">管理預購</LinkButton>} />
          <SimpleTable head={["活動", "已確認", "待付款", "上限", "預計出貨"]} rows={campaigns.data.map((c) => [c.name, c.confirmedQty ?? 0, c.reservedQty ?? 0, c.cap, c.shipDate])} empty="沒有進行中的預購" />
        </Card>
      </div>
    </>
  );
}
