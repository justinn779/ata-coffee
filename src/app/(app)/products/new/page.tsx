"use client";

import { PageHeader } from "@/components/ui";
import { ProductForm } from "../shared";

export default function NewProduct() {
  return (
    <>
      <PageHeader title="新增商品" description="建立商品後再新增 SKU 規格（例：100g、200g、單包濾掛、禮盒）" back={{ href: "/products/", label: "商品與 SKU" }} />
      <ProductForm />
    </>
  );
}
