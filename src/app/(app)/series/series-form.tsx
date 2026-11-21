import { prisma } from "@/lib/db";
import { EntityForm } from "@/components/entity-form";
import { opts, SERIES_CHARACTER } from "@/lib/labels";
import { saveSeries } from "./actions";

export async function SeriesForm({ initial }: { initial?: Record<string, unknown> }) {
  const recipes = await prisma.brewRecipe.findMany({ orderBy: [{ name: "asc" }, { version: "desc" }] });
  const d = Object.fromEntries(Object.entries(initial ?? {}).map(([k, v]) => [k, typeof v === "boolean" ? v : v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? "" : String(v)]));
  return (
    <EntityForm
      submitLabel={initial ? "儲存" : "建立系列"}
      defaultValues={{ character: "NONE", ...d }}
      fields={[
        { name: "id", label: "", type: "hidden" },
        { name: "code", label: "系列編號", required: true, placeholder: "例：ATA 003" },
        { name: "name", label: "系列名稱", required: true },
        { name: "character", label: "角色", type: "select", required: true, options: opts(SERIES_CHARACTER) },
        { name: "launchDate", label: "上市時間", type: "date" },
        { name: "recommendedRecipeId", label: "推薦手沖配方", type: "select", options: recipes.map((r) => ({ value: r.id, label: `${r.name} v${r.version}` })) },
        { name: "isLimited", label: "節日／期間限定", type: "checkbox" },
        { name: "flavorNotes", label: "風味敘述", wide: true },
        { name: "story", label: "主題故事", type: "textarea", wide: true },
      ]}
      action={saveSeries}
    />
  );
}
