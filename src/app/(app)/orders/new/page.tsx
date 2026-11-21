"use client";

import { useState } from "react";
import { opAction } from "@/lib/api";
import { useCol, useDocument } from "@/lib/data";
import { useQS, useVariantOptions } from "@/lib/page";
import { EntityForm } from "@/components/entity-form";
import { Notice, PageHeader } from "@/components/ui";

export default function NewOrderPage() {
  const customer = useQS("customer");
  const variants = useVariantOptions({ activeOnly: true });
  const customers = useCol("customers", [], "name", false);
  const tax = useDocument("settings", "tax");
  const [idem] = useState(() => crypto.randomUUID());
  const mode = tax.data?.mode ?? "INCLUSIVE";
  return (
    <>
      <PageHeader title="建立手動訂單" description={`價格與成本由系統讀取（不接受前端價格）；稅務方式：${mode === "INCLUSIVE" ? "售價含稅" : mode === "EXCLUSIVE" ? "售價外加稅" : "不計稅"}（稅率 ${Number(tax.data?.rate ?? 0.05) * 100}%）`} back={{ href: "/orders/", label: "訂單管理" }} />
      <div className="mb-4">
        <Notice>建立時立即保留現貨成品（依效期 FIFO 分配批次）；「可接單後分裝」的 SKU 若現貨不足，會自動建立分裝單並預留單一熟豆批次。庫存不足時訂單不會成立。</Notice>
      </div>
      <EntityForm
        key={`${variants.length}-${customers.data.length}`}
        draftKey="order-new"
        submitLabel="建立訂單並保留庫存"
        successMessage="訂單已建立"
        defaultValues={{ customerId: customer ?? "", items: [{ variantId: "", quantity: "1", discount: "" }], shippingFee: "0", shippingMethod: "宅配", idempotencyKey: idem }}
        sections={[
          { key: "a", title: "顧客", description: "選擇既有顧客，或直接填寫名稱（留空則帶入顧客資料）" },
          { key: "b", title: "商品" },
          { key: "c", title: "配送與備註" },
        ]}
        fields={[
          { name: "idempotencyKey", label: "", type: "hidden" },
          { name: "customerId", label: "既有顧客", type: "select", options: customers.data.map((c) => ({ value: c.id, label: `${c.name}（${c.code}）` })), section: "a" },
          { name: "customerName", label: "顧客名稱", section: "a" },
          { name: "customerPhone", label: "電話", section: "a" },
          { name: "customerEmail", label: "Email", type: "email", section: "a" },
          { name: "shippingAddress", label: "收件地址", section: "a", wide: true },
          { name: "items", label: "訂購品項", type: "array", section: "b", addLabel: "新增品項", newItem: { quantity: "1" }, itemFields: [{ name: "variantId", label: "商品 SKU", type: "select", required: true, options: variants }, { name: "quantity", label: "數量", type: "number", required: true }, { name: "discount", label: "折扣金額", type: "number", unit: "TWD" }] },
          { name: "shippingMethod", label: "配送方式", section: "c" },
          { name: "shippingFee", label: "向顧客收取運費", type: "number", unit: "TWD", section: "c" },
          { name: "note", label: "訂單備註", type: "textarea", wide: true, section: "c" },
        ]}
        action={opAction("order.create", undefined, (d) => `/orders/view/?id=${d.id}`)}
      />
    </>
  );
}
