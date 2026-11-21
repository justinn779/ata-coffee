import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { CoffeeForm } from "../../coffee-form";

export const metadata = { title: "編輯咖啡豆" };

export default async function EditCoffeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.coffee.findUnique({ where: { id } });
  if (!c) notFound();
  return (
    <>
      <PageHeader title={`編輯：${c.nameZh}`} back={{ href: `/coffees/${c.id}`, label: c.nameZh }} />
      <CoffeeForm initial={c} />
    </>
  );
}
