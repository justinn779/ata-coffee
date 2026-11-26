"use client";

import { EntityForm, type FieldDef } from "@/components/entity-form";
import { opAction } from "@/lib/api";
import { useCol, type Row } from "@/lib/data";
import { formDefaults, useNext } from "@/lib/page";

export function CoffeeForm({ initial }: { initial?: Row }) {
  const next = useNext();
  const suppliers = useCol("suppliers", [], "code", false);
  const fields: FieldDef[] = [
    { name: "id", label: "", type: "hidden" },
    { name: "nameZh", label: "中文名稱", required: true, section: "basic" },
    { name: "nameEn", label: "英文名稱", section: "basic" },
    { name: "brandName", label: "品牌商品名稱", section: "basic" },
    { name: "supplierId", label: "供應商", type: "select", options: suppliers.data.map((s) => ({ value: s.id, label: s.name })), section: "basic" },
    { name: "grade", label: "生豆等級", section: "basic" },
    { name: "country", label: "產國", section: "origin" },
    { name: "region", label: "產區", section: "origin" },
    { name: "farm", label: "莊園／處理站", section: "origin" },
    { name: "producer", label: "生產者", section: "origin" },
    { name: "variety", label: "品種", section: "origin" },
    { name: "process", label: "處理法", section: "origin" },
    { name: "altitude", label: "海拔", placeholder: "例：1900-2100m", section: "origin" },
    { name: "originFlavorNotes", label: "原始風味敘述", type: "textarea", wide: true, section: "origin" },
    { name: "restStartDays", label: "建議養豆開始天數", type: "number", unit: "天", section: "fresh" },
    { name: "peakFromDays", label: "最佳風味觀察區間（起）", type: "number", unit: "天", section: "fresh" },
    { name: "peakToDays", label: "最佳風味觀察區間（迄）", type: "number", unit: "天", section: "fresh" },
    { name: "shelfLifeDays", label: "預設保存期限（自烘焙日）", type: "number", unit: "天", hint: "依實際食品標示與營運規則設定", section: "fresh" },
    { name: "freshnessNote", label: "賞味備註", type: "textarea", wide: true, section: "fresh" },
    { name: "note", label: "備註", type: "textarea", wide: true, section: "fresh" },
  ];
  const keys = fields.map((f) => f.name);
  return (
    <EntityForm
      key={suppliers.loading ? "l" : "r"}
      fields={fields}
      sections={[
        { key: "basic", title: "基本資料" },
        { key: "origin", title: "產地與處理" },
        { key: "fresh", title: "養豆與賞味", description: "最佳風味區間不等於商品有效日期；烘焙批次可覆寫這些預設值" },
      ]}
      defaultValues={formDefaults(initial, keys)}
      action={opAction("coffee.save", undefined, (d) => next ?? `/coffees/view/?id=${d.id}`)}
      draftKey={initial ? undefined : "coffee-new"}
      submitLabel={initial ? "儲存變更" : "建立咖啡豆"}
    />
  );
}
