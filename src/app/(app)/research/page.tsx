"use client";

import { fmtDbDate } from "@/lib/time";
import { RESEARCH_STATUS } from "@/lib/labels";
import { useCol } from "@/lib/data";
import { Guard } from "@/lib/page";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status";
import { LinkButton, PageHeader } from "@/components/ui";

export default function ResearchPage() {
  const ps = useCol("researchProjects", [], "updatedAt");
  return (
    <>
      <PageHeader title="研究專案" description="假設、變因、實驗版本與基準組；統計結果與主觀觀察分開呈現" actions={<LinkButton href="/research/new/">＋ 新增專案</LinkButton>} />
      <Guard loading={ps.loading} error={ps.error}>
        {() => (
          <DataTable
            columns={[
              { key: "name", label: "專案", sortable: true },
              { key: "status", label: "狀態" },
              { key: "var", label: "實驗變因", hideOnMobile: true },
              { key: "n", label: "實驗數", align: "right" },
              { key: "date", label: "開始日期", sortable: true },
            ]}
            filters={[{ key: "status", label: "狀態", options: Object.entries(RESEARCH_STATUS).map(([value, [label]]) => ({ value, label })) }]}
            rows={ps.data.map((p) => ({
              id: p.id,
              href: `/research/view/?id=${p.id}`,
              search: [p.code, p.name, p.hypothesis, p.independentVariables].join(" "),
              filters: { status: p.status },
              sort: { name: p.name, date: p.startDate ?? null },
              cells: { name: `${p.code}｜${p.name}`, status: <StatusBadge map={RESEARCH_STATUS} value={p.status} />, var: p.independentVariables ?? "—", n: (p.experiments ?? []).length, date: fmtDbDate(p.startDate) },
            }))}
          />
        )}
      </Guard>
    </>
  );
}
