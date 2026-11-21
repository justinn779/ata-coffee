import { EntityForm } from "@/components/entity-form";
import { opts, RESEARCH_STATUS } from "@/lib/labels";
import { saveProject } from "./actions";

export function ProjectForm({ initial }: { initial?: Record<string, unknown> }) {
  const d = Object.fromEntries(Object.entries(initial ?? {}).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? "" : String(v)]));
  return (
    <EntityForm
      draftKey={initial ? undefined : "research-new"}
      defaultValues={{ status: "PLANNING", ...d }}
      submitLabel={initial ? "儲存" : "建立專案"}
      sections={[
        { key: "a", title: "研究設計" },
        { key: "b", title: "結果與結論", description: "結論請依據足夠的比較資料；主觀觀察與統計結果分開記錄" },
      ]}
      fields={[
        { name: "id", label: "", type: "hidden" },
        { name: "name", label: "專案名稱", required: true, section: "a", wide: true },
        { name: "status", label: "狀態", type: "select", required: true, options: opts(RESEARCH_STATUS), section: "a" },
        { name: "startDate", label: "開始日期", type: "date", section: "a" },
        { name: "hypothesis", label: "假設", type: "textarea", section: "a", wide: true },
        { name: "objective", label: "研究目標", type: "textarea", section: "a", wide: true },
        { name: "controlledVariables", label: "控制變因", type: "textarea", section: "a" },
        { name: "independentVariables", label: "實驗變因", type: "textarea", section: "a" },
        { name: "result", label: "結果", type: "textarea", section: "b", wide: true },
        { name: "conclusion", label: "結論", type: "textarea", section: "b", wide: true },
        { name: "nextSteps", label: "下次改善方向", type: "textarea", section: "b", wide: true },
      ]}
      action={saveProject}
    />
  );
}
