import { PageHeader } from "@/components/ui";
import { CoffeeForm } from "../coffee-form";

export const metadata = { title: "新增咖啡豆" };

export default function NewCoffeePage() {
  return (
    <>
      <PageHeader title="新增咖啡豆" back={{ href: "/coffees", label: "咖啡豆資料" }} />
      <CoffeeForm />
    </>
  );
}
