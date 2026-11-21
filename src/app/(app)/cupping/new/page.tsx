import { prisma } from "@/lib/db";
import { nowTaipeiLocal } from "@/lib/time";
import { EntityForm, type FieldDef } from "@/components/entity-form";
import { Notice, PageHeader } from "@/components/ui";
import { roastBatchOptions } from "@/server/options";
import { saveCupping } from "../actions";

export const metadata = { title: "新增杯測" };

export default async function NewCuppingPage({ searchParams }: { searchParams: Promise<{ roast?: string; template?: string }> }) {
  const sp = await searchParams;
  const [roasts, templates] = await Promise.all([roastBatchOptions(), prisma.cuppingTemplate.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] })]);
  const tpl = templates.find((t) => t.id === sp.template) ?? templates[0];
  if (!tpl) return <Notice tone="warning">請先於系統設定建立杯測評分模板。</Notice>;
  const attrs = tpl.attributes as Array<{ key: string; label: string }>;
  const fields: FieldDef[] = [
    { name: "roastBatchId", label: "烘焙批次", type: "select", required: true, options: roasts, section: "a", wide: true },
    { name: "templateId", label: "評分模板", type: "select", required: true, options: templates.map((t) => ({ value: t.id, label: t.name })), section: "a", hint: "切換模板請使用上方連結" },
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
      <PageHeader title="新增杯測" description={`評分系統：${tpl.name}（${tpl.scaleMin}–${tpl.scaleMax} 分，自訂模板，非 SCA 官方標準）`} back={{ href: "/cupping", label: "杯測實驗室" }} />
      {templates.length > 1 && (
        <p className="mb-4 text-sm text-muted">
          切換模板：
          {templates.map((t) => (
            <a key={t.id} href={`?template=${t.id}${sp.roast ? `&roast=${sp.roast}` : ""}`} className="ml-2 text-primary underline">
              {t.name}
            </a>
          ))}
        </p>
      )}
      <EntityForm
        draftKey={`cupping-new-${tpl.id}`}
        submitLabel="儲存杯測"
        defaultValues={{ roastBatchId: sp.roast ?? "", templateId: tpl.id, cuppedAt: nowTaipeiLocal(), doseG: "8.25", waterG: "150", waterTempC: "93", deductStock: true }}
        sections={[
          { key: "a", title: "杯測條件" },
          { key: "b", title: "評分", description: `每項 ${tpl.scaleMin}–${tpl.scaleMax} 分，間距 ${tpl.step}；平均分自動計算` },
          { key: "c", title: "風味與描述" },
        ]}
        fields={fields}
        action={saveCupping}
      />
    </>
  );
}
