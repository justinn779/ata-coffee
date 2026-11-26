"use client";

import { PageHeader } from "@/components/ui";
import { QuickProductForm } from "../shared";

export default function NewProduct() {
  return (
    <>
      <PageHeader title="新增商品" description="填商品名稱，再列出要賣的規格（例：100g、200g、濾掛）。上架、庫存等其他設定都用預設值，之後可以在商品頁修改。" back={{ href: "/products/", label: "商品" }} />
      <QuickProductForm />
    </>
  );
}
