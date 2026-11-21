import { EntityForm } from "@/components/entity-form";
import { saveCustomer } from "../orders/actions";

export function CustomerForm({ initial }: { initial?: Record<string, unknown> }) {
  return (
    <EntityForm
      submitLabel={initial ? "儲存" : "建立顧客"}
      defaultValues={Object.fromEntries(Object.entries(initial ?? {}).map(([k, v]) => [k, v == null ? "" : String(v)]))}
      fields={[
        { name: "id", label: "", type: "hidden" },
        { name: "name", label: "顧客名稱", required: true },
        { name: "phone", label: "電話" },
        { name: "email", label: "Email", type: "email" },
        { name: "address", label: "地址", wide: true },
        { name: "note", label: "備註", type: "textarea", wide: true },
      ]}
      action={saveCustomer}
    />
  );
}
