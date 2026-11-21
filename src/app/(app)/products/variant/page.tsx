"use client";

import { useDocument } from "@/lib/data";
import { Guard, useQS } from "@/lib/page";
import { PageHeader } from "@/components/ui";
import { VariantForm } from "../shared";

export default function VariantPage() {
  const productId = useQS("product")!;
  const id = useQS("id");
  const v = useDocument("variants", id);
  return (
    <Guard loading={!!id && v.loading} error={v.error} missing={!!id && !v.data}>
      {() => (
        <>
          <PageHeader title={id ? `編輯 SKU ${v.data!.sku}` : "新增 SKU"} description={id ? "修改售價不影響既有訂單（訂單保存價格快照）" : undefined} back={{ href: `/products/view/?id=${productId}`, label: "商品" }} />
          <VariantForm productId={productId} initial={id ? v.data : null} />
        </>
      )}
    </Guard>
  );
}
