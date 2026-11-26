"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { fmtDateTime, nowTaipeiLocal, toTaipeiLocalInput } from "@/lib/time";
import { opAction } from "@/lib/api";
import { useCol, useDocument } from "@/lib/data";
import { Guard, Loading, useCoffeeOptions, useQS, useRoastBatchOptions } from "@/lib/page";
import { SourceSwitch, sampleMode } from "@/components/bean-source";
import { EntityForm, type FieldDef } from "@/components/entity-form";
import { Notice, PageHeader } from "@/components/ui";

const s = (v: unknown) => (v == null ? "" : String(v));

/**
 * 新增杯測；帶 ?edit=<id> 時為修改模式（可以改選烘焙批次或改成沒有烘豆紀錄；評分模板不可變更）。
 * ?coffee=<id> 只列這支豆子的烘焙批次；?sample=1（或這支豆子還沒有烘豆紀錄）改為不經過烘豆紀錄，直接記在咖啡豆上。
 */
export default function NewCuppingPage() {
  const roast = useQS("roast");
  const coffee = useQS("coffee");
  const editId = useQS("edit");
  const tidQS = useQS("template");
  const sp = useSearchParams();
  const roasts = useRoastBatchOptions(coffee);
  const coffees = useCoffeeOptions();
  const templates = useCol("cuppingTemplates", [], "name", false);
  const cur = useDocument("cuppingSessions", editId);
  // 舊資料未記錄 stockTxId 時，以備註找回當初的扣庫存交易
  const legacy = useCol(editId && cur.data && cur.data.stockTxId === undefined ? "invTxs" : null, [["note", `杯測 ${(editId ?? "").slice(0, 8)}`]]);
  return (
    <Guard loading={templates.loading || (!!editId && cur.loading)} error={templates.error ?? cur.error} missing={!!editId && !cur.data}>
      {() => {
        const x = cur.data;
        const tid = x ? (x.templateId as string) : tidQS;
        const list = [...templates.data].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
        const tpl = list.find((t) => t.id === tid) ?? (x ? undefined : list[0]);
        if (!tpl) return <Notice tone="warning">{x ? "此杯測使用的評分模板已不存在，無法修改。" : "請先於系統設定建立杯測評分模板。"}</Notice>;
        const attrs = tpl.attributes as Array<{ key: string; label: string }>;
        const sample = x && !sp.get("sample") ? !x.roastBatchId : sampleMode(sp, roast, roasts.length);
        // 修改時等選單載入完再顯示表單，避免選單晚到時表單重新載入、清掉剛填的內容
        if (x && (sample ? coffees.length === 0 : roasts.length === 0)) return <Loading />;
        const fields: FieldDef[] = [
          sample
            ? { name: "coffeeId", label: "咖啡豆", type: "select", required: true, options: coffees, section: "a", wide: true }
            : { name: "roastBatchId", label: "烘焙批次", type: "select", required: true, options: roasts, section: "a", wide: true },
          ...(sample ? [{ name: "roastedDate", label: "烘焙日期（選填）", type: "date" as const, section: "a", hint: "填了才會計算烘後天數" }] : []),
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
          ...(sample ? [] : [{ name: "deductStock", label: "同步扣除熟豆庫存（杯測耗用）", type: "checkbox" as const, section: "c", hint: x ? "修改耗用量或取消勾選時，會自動沖銷原扣庫存再重新扣除" : undefined }]),
        ];
        const defaults = x
          ? {
              roastBatchId: s(x.roastBatchId),
              coffeeId: s(x.coffeeId),
              roastedDate: s(x.sampleRoastedDate),
              templateId: tpl.id,
              cuppedAt: toTaipeiLocalInput(new Date(x.cuppedAt as string)),
              evaluator: s(x.evaluator),
              grindSetting: s(x.grindSetting),
              doseG: s(x.doseG),
              waterG: s(x.waterG),
              waterTempC: s(x.waterTempC),
              scores: Object.fromEntries(((x.scores as Array<{ attributeKey: string; score: string }>) ?? []).map((q) => [q.attributeKey, s(q.score)])),
              tags: ((x.tags as string[]) ?? []).join("、"),
              defects: s(x.defects),
              description: s(x.description),
              consumedG: s(x.consumedG),
              deductStock: x.stockTxId === undefined ? legacy.data.length > 0 : !!x.stockTxId,
            }
          : { roastBatchId: roast ?? "", coffeeId: coffee ?? "", templateId: tpl.id, cuppedAt: nowTaipeiLocal(), doseG: "8.25", waterG: "150", waterTempC: "93", deductStock: true };
        return (
          <>
            <PageHeader
              title={x ? "修改杯測" : "新增杯測"}
              description={x ? `${x.roastBatchId ? x.batchNo : x.roastDeleted ? `${x.batchNo}（烘焙紀錄已刪除）` : "樣品（沒有烘豆紀錄）"} · ${x.coffeeName} · 原杯測時間 ${fmtDateTime(x.cuppedAt)}（評分模板不可變更）` : `評分系統：${tpl.name}（${tpl.scaleMin}–${tpl.scaleMax} 分，自訂模板，非 SCA 官方標準）`}
              back={x ? { href: `/cupping/view/?id=${x.id}`, label: "杯測紀錄" } : { href: "/cupping/", label: "杯測" }}
            />
            <SourceSwitch sample={sample} />
            {!x && list.length > 1 && (
              <p className="mb-4 text-sm text-muted">
                切換模板：
                {list.map((t) => (
                  <Link key={t.id} href={`/cupping/new/?${new URLSearchParams({ ...Object.fromEntries(sp), template: t.id })}`} className="ml-2 text-primary underline">
                    {t.name}
                  </Link>
                ))}
              </p>
            )}
            <EntityForm
              key={x ? `edit-${x.id}-${legacy.data.length}-${sample}` : `${tpl.id}-${roasts.length}-${coffees.length}-${sample}`}
              draftKey={x ? undefined : `cupping-new-${tpl.id}${sample ? "-sample" : ""}`}
              submitLabel={x ? "儲存修改" : "儲存杯測"}
              defaultValues={defaults}
              sections={[
                { key: "a", title: "杯測條件" },
                { key: "b", title: "評分", description: `每項 ${tpl.scaleMin}–${tpl.scaleMax} 分，間距 ${tpl.step}；平均分自動計算` },
                { key: "c", title: "風味與描述" },
              ]}
              fields={fields}
              action={x ? opAction("cupping.update", { id: x.id }, (d) => `/cupping/view/?id=${d.id}`) : opAction("cupping.create", undefined, (d) => `/cupping/view/?id=${d.id}`)}
            />
          </>
        );
      }}
    </Guard>
  );
}
