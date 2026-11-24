"use client";

import { useSearchParams } from "next/navigation";
import { fmtSec, nowTaipeiLocal, toTaipeiLocalInput } from "@/lib/time";
import { opAction } from "@/lib/api";
import { useCol, useDocument, type Row } from "@/lib/data";
import { Guard, useCoffeeOptions, useEquipmentOptions, useQS, useRoastBatchOptions } from "@/lib/page";
import { SourceSwitch, sampleMode } from "@/components/bean-source";
import { EntityForm } from "@/components/entity-form";
import { PageHeader } from "@/components/ui";

const s = (v: unknown) => (v == null ? "" : String(v));

/** 新增手沖；?copy= 複製參數；?edit=<id> 修改（烘焙批次不可變更）；?coffee= 只列這支豆子；?sample=1 不經過烘豆紀錄 */
export default function NewBrewPage() {
  const roast = useQS("roast");
  const coffee = useQS("coffee");
  const sp = useSearchParams();
  const editId = useQS("edit");
  const copy = useQS("copy") ?? editId;
  const rid = useQS("recipe");
  const roasts = useRoastBatchOptions(coffee);
  const coffees = useCoffeeOptions();
  const grinders = useEquipmentOptions("GRINDER");
  const drippers = useEquipmentOptions("DRIPPER");
  const filters = useEquipmentOptions("FILTER");
  const recipes = useCol("brewRecipes", [], "name", false);
  const src = useDocument("brewSessions", copy);
  const recipe = useDocument("brewRecipes", rid);
  const legacy = useCol(editId && src.data && src.data.stockTxId === undefined ? "invTxs" : null, [["note", `手沖試喝 ${(editId ?? "").slice(0, 8)}`]]);
  return (
    <Guard loading={(!!copy && src.loading) || (!!rid && recipe.loading)} missing={!!editId && !src.data}>
      {() => {
        const edit = editId ? src.data : null;
        const base: Row | null = src.data ?? recipe.data;
        const sample = edit ? !edit.roastBatchId : copy && src.data ? !src.data.roastBatchId && !roast : sampleMode(sp, roast, roasts.length);
        const plan = src.data ? (src.data.pourSteps as Row[]) : ((recipe.data?.pourPlan as Row[]) ?? []);
        const defaults = {
          roastBatchId: roast ?? s(src.data?.roastBatchId),
          coffeeId: coffee ?? s(src.data?.coffeeId),
          roastedDate: s(src.data?.sampleRoastedDate),
          recipeId: s(recipe.data?.id ?? src.data?.recipeId),
          brewedAt: edit ? toTaipeiLocalInput(new Date(edit.brewedAt as string)) : nowTaipeiLocal(),
          grinderId: s(base?.grinderId),
          grindSetting: s(base?.grindSetting),
          dripperId: s(base?.dripperId),
          filterId: s(base?.filterId),
          doseG: s(base?.doseG ?? "15"),
          waterG: s(base?.waterG ?? "240"),
          waterTempC: s(base?.waterTempC ?? "92"),
          waterQuality: s(src.data?.waterQuality),
          totalTimeSec: base?.totalTimeSec != null ? fmtSec(base.totalTimeSec) : "",
          bloomTimeSec: base?.bloomTimeSec != null ? fmtSec(base.bloomTimeSec) : "",
          bloomWaterG: s(base?.bloomWaterG),
          pourMethod: s(base?.pourMethod),
          agitation: s(base?.agitation),
          pourSteps: plan.map((p) => ({ startSec: p.startSec != null ? fmtSec(p.startSec) : "", endSec: p.endSec != null ? fmtSec(p.endSec) : "", waterG: s(p.waterG), note: edit ? s(p.note) : "" })),
          deductStock: edit ? (edit.stockTxId === undefined ? legacy.data.length > 0 : !!edit.stockTxId) : false,
          ...(edit
            ? { flowRateGPerSec: s(edit.flowRateGPerSec), tdsPercent: s(edit.tdsPercent), extractionPercent: s(edit.extractionPercent), rating: s(edit.rating), tags: ((edit.tags as string[]) ?? []).join("、"), flavorNotes: s(edit.flavorNotes), note: s(edit.note), isRecommended: !!edit.isRecommended }
            : {}),
        };
        return (
          <>
            <PageHeader title={edit ? "修改手沖紀錄" : src.data ? "複製手沖參數" : recipe.data ? `使用配方：${recipe.data.name} v${recipe.data.version}` : "新增手沖紀錄"} description="粉水比、烘後天數、累積水量自動計算；分段注水合計需等於總水量" back={edit ? { href: `/brewing/view/?id=${edit.id}`, label: "沖煮紀錄" } : { href: "/brewing/", label: "手沖" }} />
            {!edit && <SourceSwitch sample={sample} />}
            <EntityForm
              key={`${sample}-${coffees.length}-${roasts.length}-${grinders.length}-${drippers.length}-${recipes.data.length}-${legacy.data.length}`}
              draftKey={src.data || recipe.data ? undefined : sample ? "brew-new-sample" : "brew-new"}
              submitLabel={edit ? "儲存修改" : "儲存沖煮紀錄"}
              defaultValues={defaults}
              sections={[
                { key: "a", title: "豆子與器材" },
                { key: "b", title: "參數" },
                { key: "c", title: "分段注水" },
                { key: "d", title: "結果與評價" },
              ]}
              fields={[
                edit
                  ? { name: "roastBatchId", label: "", type: "hidden" }
                  : sample
                    ? { name: "coffeeId", label: "咖啡豆", type: "select", required: true, options: coffees, section: "a", wide: true }
                    : { name: "roastBatchId", label: "烘焙批次", type: "select", required: true, options: roasts, section: "a", wide: true },
                ...(sample ? [{ name: "roastedDate", label: "烘焙日期（選填）", type: "date" as const, section: "a", hint: "填了才會計算烘後天數" }] : []),
                { name: "brewedAt", label: "沖煮時間", type: "datetime", required: true, section: "a" },
                { name: "recipeId", label: "使用配方", type: "select", options: recipes.data.map((r) => ({ value: r.id, label: `${r.name} v${r.version}` })), section: "a" },
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
                { name: "tags", label: "風味標籤", placeholder: "以頓號分隔", section: "d", wide: true },
                { name: "flavorNotes", label: "風味表現", type: "textarea", section: "d", wide: true },
                { name: "note", label: "備註", type: "textarea", section: "d", wide: true },
                { name: "isRecommended", label: "標記為推薦沖煮", type: "checkbox", section: "d" },
                ...(sample ? [] : [{ name: "deductStock", label: "扣除熟豆庫存（試喝耗用＝粉量）", type: "checkbox" as const, section: "d", hint: edit ? "修改粉量或取消勾選時，會自動沖銷原扣庫存再重新扣除" : undefined }]),
              ]}
              action={edit ? opAction("brew.update", { id: edit.id }, (d) => `/brewing/view/?id=${d.id}`) : opAction("brew.create", undefined, (d) => `/brewing/view/?id=${d.id}`)}
            />
          </>
        );
      }}
    </Guard>
  );
}
