import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { loadVariant, VariantForm } from "../../../forms";

export default async function EditVariant({ params }: { params: Promise<{ id: string; vid: string }> }) {
  const { id, vid } = await params;
  const v = await loadVariant(vid);
  if (!v || v.productId !== id) notFound();
  return (
    <>
      <PageHeader title={`編輯 SKU ${v.sku}`} description="修改售價不影響既有訂單（訂單保存價格快照）" back={{ href: `/products/${id}`, label: "商品" }} />
      <VariantForm productId={id} initial={v} />
    </>
  );
}
