"use client";

import { EntityForm } from "@/components/entity-form";
import { opAction } from "@/lib/api";
import type { Row } from "@/lib/data";
import { formDefaults } from "@/lib/page";

export function CustomerForm({ initial }: { initial?: Row }) {
  return (
    <EntityForm
      submitLabel={initial ? "儲存" : "建立顧客"}
      defaultValues={formDefaults(initial, ["id", "name", "phone", "email", "address", "note"])}
      fields={[
        { name: "id", label: "", type: "hidden" },
        { name: "name", label: "顧客名稱", required: true },
        { name: "phone", label: "電話" },
        { name: "email", label: "Email", type: "email" },
        { name: "address", label: "地址", wide: true },
        { name: "note", label: "備註", type: "textarea", wide: true },
      ]}
      action={opAction("customer.save", undefined, (d) => `/customers/view/?id=${d.id}`)}
    />
  );
}
