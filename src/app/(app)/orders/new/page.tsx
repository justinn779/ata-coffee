"use client";

import { useState } from "react";
import { opAction } from "@/lib/api";
import { useCol, useDocument } from "@/lib/data";
import { Guard, useQS, useVariantOptions } from "@/lib/page";
import { EntityForm } from "@/components/entity-form";
import { Notice, PageHeader } from "@/components/ui";

const s = (v: unknown) => (v == null ? "" : String(v));

/** 建立手動訂單；帶 ?edit=<id> 時為出貨前修改（限未確認付款） */
export default function NewOrderPage() {
  const customer = useQS("customer");
  const editId = useQS("edit");
  const variants = useVariantOptions({ activeOnly: !editId });
  const customers = useCol("customers", [], "name", false);
  const tax = useDocument("settings", "tax");
  const cur = useDocument("orders", editId);
  const curItems = useCol(editId ? "orderItems" : null, [["orderId", editId]]);
  const [idem] = useState(() => crypto.randomUUID());
  const mode = tax.data?.mode ?? "INCLUSIVE";
  return (
    <Guard loading={!!editId && (cur.loading || curItems.loading)} error={cur.error ?? curItems.error} missing={!!editId && !cur.data}>
      {() => {
        const x = cur.data;
        const editable = x && ["PENDING", "AWAITING_PACKAGING", "READY_TO_SHIP"].includes(x.fulfillmentStatus) && ["UNPAID", "PENDING_CONFIRMATION"].includes(x.paymentStatus);
        if (x && !editable) return <Notice tone="warning">此訂單已出貨、已取消或已確認付款，無法修改。已付款訂單請先取消（含退款）後重新建立。</Notice>;
        const defaults = x
          ? {
              customerId: s(x.customerId),
              customerName: s(x.customerName),
              customerPhone: s(x.customerPhone),
              customerEmail: s(x.customerEmail),
              shippingAddress: s(x.shippingAddress),
              shippingMethod: s(x.shippingMethod),
              shippingFee: s(x.shippingFee),
              note: s(x.note),
              items: curItems.data.map((it) => ({ variantId: it.variantId, quantity: s(it.quantity), discount: Number(it.discount) ? s(it.discount) : "" })),
            }
          : { customerId: customer ?? "", items: [{ variantId: "", quantity: "1", discount: "" }], shippingFee: "0", shippingMethod: "宅配", idempotencyKey: idem };
        return (
          <>
            <PageHeader
              title={x ? `修改訂單 ${x.orderNo}` : "建立手動訂單"}
              description={`價格與成本由系統讀取（不接受前端價格）；稅務方式：${mode === "INCLUSIVE" ? "售價含稅" : mode === "EXCLUSIVE" ? "售價外加稅" : "不計稅"}（稅率 ${Number(tax.data?.rate ?? 0.05) * 100}%）`}
              back={x ? { href: `/orders/view/?id=${x.id}`, label: `訂單 ${x.orderNo}` } : { href: "/orders/", label: "訂單管理" }}
            />
            <div className="mb-4">
              {x ? (
                <Notice>儲存時會先釋放原本保留的庫存、取消未完成的接單後分裝單，再依新內容重新保留（FIFO）。原有品項沿用下單時單價，新增品項使用目前售價。庫存不足時修改不會生效，原訂單維持不變。</Notice>
              ) : (
                <Notice>建立時立即保留現貨成品（依效期 FIFO 分配批次）；「可接單後分裝」的品項 若現貨不足，會自動建立分裝單並預留單一熟豆批次。庫存不足時訂單不會成立。</Notice>
              )}
            </div>
            <EntityForm
              key={`${variants.length}-${customers.data.length}-${x?.id ?? ""}-${curItems.data.length}`}
              draftKey={x ? undefined : "order-new"}
              submitLabel={x ? "儲存修改並重新保留庫存" : "建立訂單並保留庫存"}
              successMessage={x ? "訂單已修改" : "訂單已建立"}
              defaultValues={defaults}
              sections={[
                { key: "a", title: "顧客", description: "選擇既有顧客，或直接填寫名稱（留空則帶入顧客資料）" },
                { key: "b", title: "商品" },
                { key: "c", title: "配送與備註" },
              ]}
              fields={[
                ...(x ? [] : [{ name: "idempotencyKey", label: "", type: "hidden" as const }]),
                { name: "customerId", label: "既有顧客", type: "select", options: customers.data.map((c) => ({ value: c.id, label: `${c.name}（${c.code}）` })), section: "a" },
                { name: "customerName", label: "顧客名稱", section: "a" },
                { name: "customerPhone", label: "電話", section: "a" },
                { name: "customerEmail", label: "Email", type: "email", section: "a" },
                { name: "shippingAddress", label: "收件地址", section: "a", wide: true },
                { name: "items", label: "訂購品項", type: "array", section: "b", addLabel: "新增品項", newItem: { quantity: "1" }, itemFields: [{ name: "variantId", label: "商品品項", type: "select", required: true, options: variants }, { name: "quantity", label: "數量", type: "number", required: true }, { name: "discount", label: "折扣金額", type: "number", unit: "TWD" }] },
                { name: "shippingMethod", label: "配送方式", section: "c" },
                { name: "shippingFee", label: "向顧客收取運費", type: "number", unit: "TWD", section: "c" },
                { name: "note", label: "訂單備註", type: "textarea", wide: true, section: "c" },
              ]}
              action={x ? opAction("order.update", { orderId: x.id }, (d) => `/orders/view/?id=${d.id}`) : opAction("order.create", undefined, (d) => `/orders/view/?id=${d.id}`)}
            />
          </>
        );
      }}
    </Guard>
  );
}
