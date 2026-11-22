"use client";

import { PageHeader } from "@/components/ui";
import { CoffeeForm } from "../coffee-form";

export default function NewCoffeePage() {
  return (
    <>
      <PageHeader title="新增咖啡豆" back={{ href: "/coffees/", label: "生豆資訊" }} />
      <CoffeeForm />
    </>
  );
}
