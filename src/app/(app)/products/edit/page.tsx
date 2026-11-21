"use client";

import { useDocument } from "@/lib/data";
import { Guard, useQS } from "@/lib/page";
import { PageHeader } from "@/components/ui";
import { ProductForm } from "../shared";

export default function EditProduct() {
  const id = useQS("id");
  const p = useDocument("products", id);
  return (
    <Guard loading={p.loading} error={p.error} missing={!p.data}>
      {() => (
        <>
          <PageHeader title={`編輯：${p.data!.name}`} back={{ href: `/products/view/?id=${id}`, label: p.data!.name }} />
          <ProductForm initial={p.data!} />
        </>
      )}
    </Guard>
  );
}
