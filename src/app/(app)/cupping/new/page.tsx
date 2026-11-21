"use client";

import Link from "next/link";
import { nowTaipeiLocal } from "@/lib/time";
import { opAction } from "@/lib/api";
import { useCol } from "@/lib/data";
import { Guard, useQS, useRoastBatchOptions } from "@/lib/page";
import { EntityForm, type FieldDef } from "@/components/entity-form";
import { Notice, PageHeader } from "@/components/ui";

export default function NewCuppingPage() {
  const roast = useQS("roast");
  const tid = useQS("template");
  const roasts = useRoastBatchOptions();
  const templates = useCol("cuppingTemplates", [], "name", false);
  return (
    <Guard loading={templates.loading} error={templates.error}>
      {() => {
        const list = [...templates.data].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
        const tpl = list.find((t) => t.id === tid) ?? list[0];
        if (!tpl) return <Notice tone="warning">請先於系統設定建立杯測評分模板。</Notice>;
        const attrs = tpl.attributes as Array<{ key: string; label: string }>;
        const fields: FieldDef[] = [
          { name: "roastBatchId", label: "烘焙批次", type: "select", required: true, options: roasts, section: "a", wide: true },
          { name: "templateId", label: "", type: "hidden" },
          { name: "cuppedAt", label: "杯測時間", type: "datetime", required: true, section: "a", hint: "烘後天數將自動計算" },
          { name: "evaluator", label: "評分者", section: "a" },
          { name: "grindSetting", label: "研磨度", section: "a" },
          { name: "doseG", label: "粉量", type: "number", unit: "g", section: "a" },
          { name: "waterG", label: "水量", type: "number", unit: "g", section: "a" },
          { name: "waterTempC", label: "水溫", type: "number", unit: "°C", section: "a" },
          ...attrs.map((a) => ({ name: `scores.${a.key}`, label: a.label, type: "number" as const, unit: `/${tpl.scaleMax}`, section: "b" })),
          { name: "tags", label: "風味標籤", placeholder: "以頓號或逗號分隔，例：茉莉花、柑橘", section: "c", wide: true, hint: "新詞彙會自動加入風味詞彙表" },
          { name: "defects", label: "瑕疵", section: "c", wide: true },
          { name: "description", label: "文字描述", type: "textarea", section: "c", wide: true },
          { name: "consumedG", label: "熟豆耗用量", type: "number", unit: "g", section: "c" },
          { name: "deductStock", label: "同步扣除熟豆庫存（杯測耗用）", type: "checkbox", section: "c" },
        ];
        return (
          <>
            <PageHeader title="新增杯測" description={`評分系統：${tpl.name}（${tpl.scaleMin}–${tpl.scaleMax} 分，自訂模板，非 SCA 官方標準）`} back={{ href: "/cupping/", label: "杯測實驗室" }} />
            {list.length > 1 && (
              <p className="mb-4 text-sm text-muted">
                切換模板：
                {list.map((t) => (
                  <Link key={t.id} href={`/cupping/new/?template=${t.id}${roast ? `&roast=${roast}` : ""}`} className="ml-2 text-primary underline">
                    {t.name}
                  </Link>
                ))}
              </p>
            )}
            <EntityForm
              key={`${tpl.id}-${roasts.length}`}
              draftKey={`cupping-new-${tpl.id}`}
              submitLabel="儲存杯測"
              defaultValues={{ roastBatchId: roast ?? "", templateId: tpl.id, cuppedAt: nowTaipeiLocal(), doseG: "8.25", waterG: "150", waterTempC: "93", deductStock: true }}
              sections={[
                { key: "a", title: "杯測條件" },
                { key: "b", title: "評分", description: `每項 ${tpl.scaleMin}–${tpl.scaleMax} 分，間距 ${tpl.step}；平均分自動計算` },
                { key: "c", title: "風味與描述" },
              ]}
              fields={fields}
              action={opAction("cupping.create", undefined, (d) => `/cupping/view/?id=${d.id}`)}
            />
          </>
        );
      }}
    </Guard>
  );
}
