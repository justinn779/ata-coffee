"use client";

import { PageHeader } from "@/components/ui";
import { CustomerForm } from "../customer-form";

export default function NewCustomer() {
  return (
    <>
      <PageHeader title="新增顧客" back={{ href: "/customers/", label: "顧客" }} />
      <CustomerForm />
    </>
  );
}
