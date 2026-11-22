"use client";

import { fmtSec, nowTaipeiLocal } from "@/lib/time";
import { opAction } from "@/lib/api";
import { useCol, useDocument } from "@/lib/data";
import { opts, ROAST_EVENT } from "@/lib/labels";
import { Guard, useGreenLotOptions, useQS } from "@/lib/page";
import { EntityForm } from "@/components/entity-form";
import { Notice, PageHeader } from "@/components/ui";

const s = (v: unknown) => (v == null ? "" : String(v));
const mm = (v: number | null | undefined) => (v == null ? "" : fmtSec(v));

export default function NewRoastPage() {
  const copy = useQS("copy");
  const green = useQS("green");
  const greens = useGreenLotOptions();
  const roasters = useCol("roasters", [], "name", false);
  const src = useDocument("roastBatches", copy);
  const costs = useCol(copy ? "costEntries" : null, [["roastBatchId", copy]]);
  return (
    <Guard loading={roasters.loading || (!!copy && (src.loading || costs.loading))}>
      {() => {
        const b = src.data;
        const cost = (cat: string) => costs.data.find((c) => c.category === cat);
        const defaults = {
          greenLotId: green ?? s(b?.greenLotId),
          roasterId: s(b?.roasterId ?? roasters.data[0]?.id),
          roastedAt: nowTaipeiLocal(),
          greenWeightG: s(b?.greenWeightG),
          roastedWeightG: "",
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
          copiedFromId: s(b?.id),
          events: ((b?.events as Array<Record<string, unknown>>) ?? []).filter((e) => ["HEAT_CHANGE", "AIRFLOW_CHANGE", "DRUM_CHANGE", "NOTE"].includes(e.type as string)).map((e) => ({ timeSec: fmtSec(e.timeSec as number), type: e.type, btC: "", heat: s(e.heat), airflow: s(e.airflow), note: s(e.note) })),
        };
        return (
          <>
            <PageHeader title={b ? `複製批次 ${b.batchNo} 的設定` : "開始新一批烘焙"} description="送出時於同一交易中扣除生豆、建立熟豆批次並計算成本。時間格式 mm:ss（自入豆起算）；未填的事件不會被推估。" back={{ href: "/roasting/", label: "烘豆紀錄" }} />
            {greens.length === 0 || roasters.data.length === 0 ? (
              <Notice tone="warning">{greens.length === 0 ? "沒有可用的生豆批次，請先新增生豆採購。" : "請先於系統設定建立烘豆機。"}</Notice>
            ) : (
              <EntityForm
                key={greens.length}
                draftKey={b ? undefined : "roast-new"}
                submitLabel="過帳烘焙批次"
                successMessage="烘焙批次已建立"
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
                action={opAction("roast.create", undefined, (d) => `/roasting/view/?id=${d.id}`)}
              />
            )}
          </>
        );
      }}
    </Guard>
  );
}
