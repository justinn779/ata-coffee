import { prisma } from "@/lib/db";
import { fmtSec, nowTaipeiLocal } from "@/lib/time";
import { EntityForm } from "@/components/entity-form";
import { PageHeader } from "@/components/ui";
import { equipmentOptions, roastBatchOptions } from "@/server/options";
import { saveBrew } from "../actions";

export const metadata = { title: "新增手沖紀錄" };
const s = (v: unknown) => (v == null ? "" : String(v));

export default async function NewBrewPage({ searchParams }: { searchParams: Promise<{ roast?: string; copy?: string; recipe?: string }> }) {
  const sp = await searchParams;
  const [roasts, grinders, drippers, filters, recipes, src, recipe] = await Promise.all([
    roastBatchOptions(),
    equipmentOptions("GRINDER"),
    equipmentOptions("DRIPPER"),
    equipmentOptions("FILTER"),
    prisma.brewRecipe.findMany({ orderBy: [{ name: "asc" }, { version: "desc" }] }),
    sp.copy ? prisma.brewSession.findUnique({ where: { id: sp.copy }, include: { pourSteps: { orderBy: { stepNo: "asc" } }, tags: { include: { flavorTag: true } } } }) : null,
    sp.recipe ? prisma.brewRecipe.findUnique({ where: { id: sp.recipe } }) : null,
  ]);
  const base = src ?? recipe;
  const plan = src ? src.pourSteps.map((p) => ({ startSec: p.startSec, endSec: p.endSec, waterG: p.waterG })) : ((recipe?.pourPlan as Array<{ startSec: number; endSec: number; waterG: string }> | null) ?? []);
  const defaults = {
    roastBatchId: sp.roast ?? s(src?.roastBatchId),
    recipeId: s(recipe?.id ?? src?.recipeId),
    brewedAt: nowTaipeiLocal(),
    grinderId: s(base?.grinderId),
    grindSetting: s(base?.grindSetting),
    dripperId: s(base?.dripperId),
    filterId: s(base?.filterId),
    doseG: s(base?.doseG ?? "15"),
    waterG: s(base?.waterG ?? "240"),
    waterTempC: s(base?.waterTempC ?? "92"),
    waterQuality: s(src?.waterQuality),
    totalTimeSec: base?.totalTimeSec != null ? fmtSec(base.totalTimeSec) : "",
    bloomTimeSec: base?.bloomTimeSec != null ? fmtSec(base.bloomTimeSec) : "",
    bloomWaterG: s(base?.bloomWaterG),
    pourMethod: s(base?.pourMethod),
    agitation: s(base?.agitation),
    pourSteps: plan.map((p) => ({ startSec: p.startSec != null ? fmtSec(p.startSec) : "", endSec: p.endSec != null ? fmtSec(p.endSec) : "", waterG: s(p.waterG), note: "" })),
    deductStock: false,
  };
  return (
    <>
      <PageHeader title={src ? "複製手沖參數" : recipe ? `使用配方：${recipe.name} v${recipe.version}` : "新增手沖紀錄"} description="粉水比、烘後天數、累積水量自動計算；分段注水合計需等於總水量" back={{ href: "/brewing", label: "手沖實驗室" }} />
      <EntityForm
        draftKey={src || recipe ? undefined : "brew-new"}
        submitLabel="儲存沖煮紀錄"
        defaultValues={defaults}
        sections={[
          { key: "a", title: "豆子與器材" },
          { key: "b", title: "參數" },
          { key: "c", title: "分段注水" },
          { key: "d", title: "結果與評價" },
        ]}
        fields={[
          { name: "roastBatchId", label: "烘焙批次", type: "select", required: true, options: roasts, section: "a", wide: true },
          { name: "brewedAt", label: "沖煮時間", type: "datetime", required: true, section: "a" },
          { name: "recipeId", label: "使用配方", type: "select", options: recipes.map((r) => ({ value: r.id, label: `${r.name} v${r.version}` })), section: "a" },
          { name: "grinderId", label: "研磨機", type: "select", options: grinders, section: "a" },
          { name: "grindSetting", label: "研磨刻度", section: "a" },
          { name: "dripperId", label: "濾杯", type: "select", options: drippers, section: "a" },
          { name: "filterId", label: "濾紙", type: "select", options: filters, section: "a" },
          { name: "doseG", label: "粉量", type: "number", unit: "g", required: true, section: "b" },
          { name: "waterG", label: "總水量", type: "number", unit: "g", required: true, section: "b" },
          { name: "waterTempC", label: "水溫", type: "number", unit: "°C", section: "b" },
          { name: "waterQuality", label: "水質", section: "b" },
          { name: "bloomWaterG", label: "悶蒸水量", type: "number", unit: "g", section: "b" },
          { name: "bloomTimeSec", label: "悶蒸時間", type: "mmss", section: "b" },
          { name: "totalTimeSec", label: "總沖煮時間", type: "mmss", section: "b" },
          { name: "pourMethod", label: "注水方式", section: "b" },
          { name: "flowRateGPerSec", label: "流速（選填）", type: "number", unit: "g/s", section: "b" },
          { name: "agitation", label: "攪拌方式", section: "b" },
          {
            name: "pourSteps",
            label: "注水段落（第 1 段通常為悶蒸）",
            type: "array",
            section: "c",
            addLabel: "新增一段",
            itemFields: [
              { name: "startSec", label: "起始", type: "mmss" },
              { name: "endSec", label: "結束", type: "mmss" },
              { name: "waterG", label: "注水量", type: "number", unit: "g", required: true },
              { name: "note", label: "操作備註" },
            ],
          },
          { name: "tdsPercent", label: "TDS（選填）", type: "number", unit: "%", section: "d" },
          { name: "extractionPercent", label: "萃取率（選填）", type: "number", unit: "%", section: "d" },
          { name: "rating", label: "評價（0–10）", type: "number", section: "d" },
          { name: "tags", label: "風味標籤", placeholder: "以頓號分隔", section: "d", wide: true, ...(src ? {} : {}) },
          { name: "flavorNotes", label: "風味表現", type: "textarea", section: "d", wide: true },
          { name: "note", label: "備註", type: "textarea", section: "d", wide: true },
          { name: "isRecommended", label: "標記為推薦沖煮", type: "checkbox", section: "d" },
          { name: "deductStock", label: "扣除熟豆庫存（試喝耗用＝粉量）", type: "checkbox", section: "d" },
        ]}
        action={saveBrew}
      />
    </>
  );
}
