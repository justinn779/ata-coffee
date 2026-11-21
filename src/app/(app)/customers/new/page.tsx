import { PageHeader } from "@/components/ui";
import { CustomerForm } from "../customer-form";

export const metadata = { title: "新增顧客" };

export default function NewCustomer() {
  return (
    <>
      <PageHeader title="新增顧客" back={{ href: "/customers", label: "顧客" }} />
      <CustomerForm />
    </>
  );
}
