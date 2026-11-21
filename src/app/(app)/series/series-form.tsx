"use client";

import { EntityForm } from "@/components/entity-form";
import { opts, SERIES_CHARACTER } from "@/lib/labels";
import { opAction } from "@/lib/api";
import { useCol, type Row } from "@/lib/data";
import { formDefaults } from "@/lib/page";

export function SeriesForm({ initial }: { initial?: Row }) {
  const recipes = useCol("brewRecipes", [], "name", false);
  return (
    <EntityForm
      key={recipes.data.length}
      submitLabel={initial ? "儲存" : "建立系列"}
      defaultValues={{ character: "NONE", ...formDefaults(initial, ["id", "code", "name", "character", "launchDate", "recommendedRecipeId", "isLimited", "flavorNotes", "story"]) }}
      fields={[
        { name: "id", label: "", type: "hidden" },
        { name: "code", label: "系列編號", required: true, placeholder: "例：ATA 003" },
        { name: "name", label: "系列名稱", required: true },
        { name: "character", label: "角色", type: "select", required: true, options: opts(SERIES_CHARACTER) },
        { name: "launchDate", label: "上市時間", type: "date" },
        { name: "recommendedRecipeId", label: "推薦手沖配方", type: "select", options: recipes.data.map((r) => ({ value: r.id, label: `${r.name} v${r.version}` })) },
        { name: "isLimited", label: "節日／期間限定", type: "checkbox" },
        { name: "flavorNotes", label: "風味敘述", wide: true },
        { name: "story", label: "主題故事", type: "textarea", wide: true },
      ]}
      action={opAction("series.save", undefined, (d) => `/series/view/?id=${d.id}`)}
    />
  );
}
