"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { fmtSec, nowTaipeiLocal, toTaipeiLocalInput } from "@/lib/time";
import { opAction } from "@/lib/api";
import { useCol, useDocument } from "@/lib/data";
import { opts, ROAST_EVENT } from "@/lib/labels";
import { Guard, useGreenLotOptions, useQS, withNext } from "@/lib/page";
import { EntityForm } from "@/components/entity-form";
import { LinkButton, Notice, PageHeader } from "@/components/ui";
import { clearLive, liveToRoastForm, loadLive } from "../live-draft";

/** 帶入表單：去掉小數尾端多餘的 0（255.000 → 255） */
const s = (v: unknown) => (v == null ? "" : String(v).replace(/^(-?\d+)\.(\d*?)0+$/, (_, a: string, b: string) => (b ? `${a}.${b}` : a)));
const mm = (v: number | null | undefined) => (v == null ? "" : fmtSec(v));

/** 新增烘焙批次；?copy=<id> 複製設定，?edit=<id> 修改已過帳的批次，?live=1 過帳平板即時紀錄，?coffee=<id> 只列這支豆子的生豆 */
export default function NewRoastPage() {
  const editId = useQS("edit");
  const copyQS = useQS("copy");
  const copy = editId ?? copyQS;
  const green = useQS("green");
  const coffee = useQS("coffee");
  const sp = useSearchParams();
  const roasters = useCol("roasters", [], "name", false);
  const src = useDocument("roastBatches", copy);
  const greens = useGreenLotOptions(editId ? (src.data?.greenLotId as string | undefined) : null, editId ? null : coffee);
  const costs = useCol(copy ? "costEntries" : null, [["roastBatchId", copy]]);
  const fromLive = useQS("live") === "1";
  const here = `/roasting/new/${sp.toString() ? `?${sp.toString()}` : ""}`;
  const [live] = useState(() => {
    if (!fromLive || typeof window === "undefined") return null;
    const d = loadLive();
    return d ? liveToRoastForm(d) : null;
  });
  return (
    <Guard loading={roasters.loading || (!!copy && (src.loading || costs.loading))} missing={!!editId && !src.data}>
      {() => {
        const b = src.data;
        const edit = !!editId && !!b;
        const cost = (cat: string) => costs.data.find((c) => c.category === cat);
        const defaults = {
          greenLotId: green ?? s(b?.greenLotId),
          roasterId: s(b?.roasterId ?? roasters.data[0]?.id),
          roastedAt: edit ? toTaipeiLocalInput(new Date(b.roastedAt as string)) : nowTaipeiLocal(),
          greenWeightG: s(b?.greenWeightG),
          roastedWeightG: edit ? s(b?.roastedWeightG) : "",
          qualityRating: edit ? s(b?.qualityRating) : "",
          result: edit ? s(b?.result) : "",
          note: edit ? s(b?.note) : "",
          restStartDays: edit ? s(b?.restStartDays) : "",
          peakFromDays: edit ? s(b?.peakFromDays) : "",
          peakToDays: edit ? s(b?.peakToDays) : "",
          shelfLifeDays: edit ? s(b?.shelfLifeDays) : "",
          chargeTempC: s(b?.chargeTempC),
          turningPointSec: mm(b?.turningPointSec),
          turningPointTempC: s(b?.turningPointTempC),
          dryEndSec: mm(b?.dryEndSec),
          firstCrackStartSec: mm(b?.firstCrackStartSec),
          firstCrackEndSec: mm(b?.firstCrackEndSec),
          dropSec: mm(b?.dropSec),
          dropTempC: s(b?.dropTempC),
          roastLevel: s(b?.roastLevel),
          targetProfile: s(b?.targetProfile),
          energyCost: s(cost("ROAST_ENERGY")?.amount),
          energyIsEstimate: cost("ROAST_ENERGY")?.isEstimate ?? true,
          energyNote: s(cost("ROAST_ENERGY")?.calcNote),
          laborCost: s(cost("ROAST_LABOR")?.amount),
          laborIsEstimate: cost("ROAST_LABOR")?.isEstimate ?? true,
          copiedFromId: edit ? s(b?.copiedFromId) : s(b?.id),
          ...(live?.defaults ?? {}),
          events: ((b?.events as Array<Record<string, unknown>>) ?? []).filter((e) => edit || ["HEAT_CHANGE", "AIRFLOW_CHANGE", "DRUM_CHANGE", "NOTE"].includes(e.type as string)).map((e) => ({ timeSec: fmtSec(e.timeSec as number), type: e.type, btC: edit ? s(e.btC) : "", heat: s(e.heat), airflow: s(e.airflow), note: s(e.note) })),
        };
        return (
          <>
            <PageHeader title={live ? "過帳平板即時紀錄" : edit ? `修改 ${b.batchNo}` : b ? `複製批次 ${b.batchNo} 的設定` : "開始新一批烘焙"} back={edit ? { href: `/roasting/view/?id=${b.id}`, label: b.batchNo } : { href: "/roasting/", label: "烘豆紀錄" }} />
            {edit && (
              <div className="mb-4">
                <Notice>
                  <span title="改生豆批次、重量或成本時，會自動補扣或退回生豆、調整熟豆庫存與成本；杯測、手沖的烘後天數與 QR 履歷也會一起更新。熟豆已分裝或出貨後，重量與成本不能再改。">修改後，庫存、成本與相關紀錄會自動一起更新。</span>
                </Notice>
              </div>
            )}
            {live && (
              <div className="mb-4">
                <Notice>
                  <span title="時間事件與豆溫、火力、風門、鍋速紀錄點，過帳時會存成這批的烘焙曲線">已帶入 {live.curvePoints.length} 個紀錄點與時間事件，補上出爐重量即可過帳。</span>
                </Notice>
              </div>
            )}
            {greens.length === 0 ? (
              <Notice tone="warning">
                <span className="flex flex-wrap items-center justify-between gap-3">
                  {live ? "還沒有生豆批次可以扣庫存。平板紀錄已保存，新增完會回到這裡。" : coffee ? "這支豆子還沒有生豆庫存，先新增一筆生豆採購，完成後會回到這裡繼續烘豆。" : "還沒有生豆批次，請先新增生豆採購。"}
                  <LinkButton size="sm" href={withNext(coffee ? `/green/new/?coffee=${coffee}` : "/green/new/", here)}>
                    ＋ 新增生豆採購
                  </LinkButton>
                </span>
              </Notice>
            ) : roasters.data.length === 0 ? (
              <Notice tone="warning">
                <span className="flex flex-wrap items-center justify-between gap-3">
                  還沒有烘豆機，請先在系統設定新增。{live && "平板紀錄已保存，新增完再回來過帳。"}
                  <LinkButton size="sm" href="/settings/?s=roasters">
                    前往設定烘豆機
                  </LinkButton>
                </span>
              </Notice>
            ) : (
              <EntityForm
                key={`${greens.length}-${b?.updatedAt ?? ""}`}
                draftKey={b || live ? undefined : "roast-new"}
                submitLabel={edit ? "儲存修改" : "過帳烘焙批次"}
                successMessage={edit ? "已更新烘焙批次" : "烘焙批次已建立"}
                defaultValues={defaults}
                sections={[
                  { key: "a", title: "批次與重量" },
                  { key: "b", title: "時間事件", description: "DTR、各期時間依實際輸入計算" },
                  { key: "c", title: "結果與評價" },
                  { key: "d", title: "成本", description: "可區分估計成本與實際成本" },
                  { key: "e", title: "操作紀錄與賞味覆寫" },
                ]}
                fields={[
                  { name: "copiedFromId", label: "", type: "hidden" },
                  { name: "greenLotId", label: "生豆批次", type: "select", required: true, options: greens, section: "a", wide: true },
                  { name: "roasterId", label: "烘豆機", type: "select", required: true, options: roasters.data.map((r) => ({ value: r.id, label: r.name })), section: "a" },
                  { name: "roastedAt", label: "烘焙日期時間", type: "datetime", required: true, section: "a" },
                  { name: "greenWeightG", label: "投入生豆重量", type: "number", unit: "g", required: true, section: "a" },
                  { name: "roastedWeightG", label: "出爐熟豆重量", type: "number", unit: "g", required: true, section: "a" },
                  { name: "chargeTempC", label: "入豆溫", type: "number", unit: "°C", section: "b" },
                  { name: "turningPointSec", label: "轉折點時間", type: "mmss", section: "b" },
                  { name: "turningPointTempC", label: "轉折點溫度", type: "number", unit: "°C", section: "b" },
                  { name: "dryEndSec", label: "轉黃點", type: "mmss", section: "b" },
                  { name: "firstCrackStartSec", label: "一爆開始", type: "mmss", section: "b" },
                  { name: "firstCrackEndSec", label: "一爆結束（選填）", type: "mmss", section: "b" },
                  { name: "dropSec", label: "下豆時間", type: "mmss", section: "b" },
                  { name: "dropTempC", label: "下豆溫", type: "number", unit: "°C", section: "b" },
                  { name: "roastLevel", label: "烘焙程度", placeholder: "例：淺焙", section: "c" },
                  { name: "targetProfile", label: "烘焙目標", section: "c" },
                  { name: "qualityRating", label: "品質評價（1–10）", type: "number", section: "c" },
                  { name: "result", label: "烘焙結果", type: "textarea", wide: true, section: "c" },
                  { name: "note", label: "備註", type: "textarea", wide: true, section: "c" },
                  { name: "energyCost", label: "烘焙能源成本", type: "number", unit: "TWD", section: "d" },
                  { name: "energyIsEstimate", label: "能源成本為估計值", type: "checkbox", section: "d" },
                  { name: "energyNote", label: "能源計算方式", placeholder: "例：1.2 度 × NT$4.5", section: "d" },
                  { name: "laborCost", label: "烘焙人工成本", type: "number", unit: "TWD", section: "d" },
                  { name: "laborIsEstimate", label: "人工成本為估計值", type: "checkbox", section: "d" },
                  {
                    name: "events",
                    label: "火力／風門／轉速調整（選填，依烘豆機可用通道）",
                    type: "array",
                    section: "e",
                    addLabel: "新增事件",
                    newItem: { type: "HEAT_CHANGE" },
                    itemFields: [
                      { name: "timeSec", label: "時間", type: "mmss" },
                      { name: "type", label: "事件", type: "select", required: true, options: opts(ROAST_EVENT) },
                      { name: "btC", label: "BT", type: "number", unit: "°C" },
                      { name: "heat", label: "火力" },
                      { name: "airflow", label: "風門" },
                      { name: "note", label: "備註" },
                    ],
                  },
                  { name: "restStartDays", label: "覆寫：養豆開始天數", type: "number", unit: "天", section: "e" },
                  { name: "peakFromDays", label: "覆寫：最佳區間起", type: "number", unit: "天", section: "e" },
                  { name: "peakToDays", label: "覆寫：最佳區間迄", type: "number", unit: "天", section: "e" },
                  { name: "shelfLifeDays", label: "覆寫：保存期限", type: "number", unit: "天", section: "e", hint: "留空使用咖啡豆預設" },
                ]}
                action={opAction(edit ? "roast.update" : "roast.create", edit ? { id: b.id } : live ? { curvePoints: live.curvePoints } : undefined, (d) => {
                  if (live) clearLive();
                  return `/roasting/view/?id=${d.id}`;
                })}
              />
            )}
          </>
        );
      }}
    </Guard>
  );
}
