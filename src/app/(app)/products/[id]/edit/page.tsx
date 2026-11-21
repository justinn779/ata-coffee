import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ProductForm } from "../../forms";

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await prisma.product.findUnique({ where: { id } });
  if (!p) notFound();
  return (
    <>
      <PageHeader title={`編輯：${p.name}`} back={{ href: `/products/${id}`, label: p.name }} />
      <ProductForm initial={p} />
    </>
  );
}
