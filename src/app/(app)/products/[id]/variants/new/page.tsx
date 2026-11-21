import { PageHeader } from "@/components/ui";
import { VariantForm } from "../../../forms";

export default async function NewVariant({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader title="新增 SKU" back={{ href: `/products/${id}`, label: "商品" }} />
      <VariantForm productId={id} />
    </>
  );
}
