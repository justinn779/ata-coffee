"use client";

import { useDocument } from "@/lib/data";
import { Guard, useQS } from "@/lib/page";
import { PageHeader } from "@/components/ui";
import { CoffeeForm } from "../coffee-form";

export default function EditCoffeePage() {
  const id = useQS("id");
  const c = useDocument("coffees", id);
  return (
    <Guard loading={c.loading} error={c.error} missing={!c.data}>
      {() => (
        <>
          <PageHeader title={`編輯：${c.data!.nameZh}`} back={{ href: `/coffees/view/?id=${id}`, label: c.data!.nameZh }} />
          <CoffeeForm initial={c.data!} />
        </>
      )}
    </Guard>
  );
}
