import { prisma } from "@/lib/db";
import { fmtSec, nowTaipeiLocal } from "@/lib/time";
import { EntityForm } from "@/components/entity-form";
import { Notice, PageHeader } from "@/components/ui";
import { opts, ROAST_EVENT } from "@/lib/labels";
import { greenLotOptions } from "@/server/options";
import { createRoast } from "../actions";

export const metadata = { title: "開始新一批烘焙" };

const s = (v: unknown) => (v == null ? "" : String(v));
const mm = (v: number | null) => (v == null ? "" : fmtSec(v));

export default async function NewRoastPage({ searchParams }: { searchParams: Promise<{ copy?: string; green?: string }> }) {
  const { copy, green } = await searchParams;
  const [greens, roasters, src] = await Promise.all([
    greenLotOptions(),
    prisma.roasterProfile.findMany({ where: { isActive: true } }),
    copy ? prisma.roastBatch.findUnique({ where: { id: copy }, include: { events: { orderBy: { timeSec: "asc" } }, costEntries: true } }) : null,
  ]);
  const cost = (cat: string) => src?.costEntries.find((c) => c.category === cat);
  const defaults: Record<string, unknown> = {
    greenLotId: green ?? s(src?.greenLotId),
    roasterId: s(src?.roasterId ?? roasters[0]?.id),
    roastedAt: nowTaipeiLocal(),
    greenWeightG: s(src?.greenWeightG),
    roastedWeightG: "",
    chargeTempC: s(src?.chargeTempC),
    turningPointSec: mm(src?.turningPointSec ?? null),
    turningPointTempC: s(src?.turningPointTempC),
    dryEndSec: mm(src?.dryEndSec ?? null),
    firstCrackStartSec: mm(src?.firstCrackStartSec ?? null),
    firstCrackEndSec: mm(src?.firstCrackEndSec ?? null),
    dropSec: mm(src?.dropSec ?? null),
    dropTempC: s(src?.dropTempC),
    roastLevel: s(src?.roastLevel),
    targetProfile: s(src?.targetProfile),
    energyCost: s(cost("ROAST_ENERGY")?.amount),
    energyIsEstimate: cost("ROAST_ENERGY")?.isEstimate ?? true,
    energyNote: s(cost("ROAST_ENERGY")?.calcNote),
    laborCost: s(cost("ROAST_LABOR")?.amount),
    laborIsEstimate: cost("ROAST_LABOR")?.isEstimate ?? true,
    copiedFromId: s(src?.id),
    events: (src?.events ?? []).filter((e) => ["HEAT_CHANGE", "AIRFLOW_CHANGE", "DRUM_CHANGE", "NOTE"].includes(e.type)).map((e) => ({ timeSec: fmtSec(e.timeSec), type: e.type, btC: "", etC: "", heat: s(e.heat), airflow: s(e.airflow), drumSpeed: s(e.drumSpeed), note: s(e.note) })),
  };
  return (
    <>
      <PageHeader
        title={src ? `複製批次 ${src.batchNo} 的設定` : "開始新一批烘焙"}
        description="送出時於同一交易中扣除生豆、建立熟豆批次並計算成本。時間格式 mm:ss（自入豆起算）；未填的事件不會被推估。"
        back={{ href: "/roasting", label: "烘焙中心" }}
      />
      {greens.length === 0 || roasters.length === 0 ? (
        <Notice tone="warning">{greens.length === 0 ? "沒有可用的生豆批次，請先新增生豆採購。" : "請先於系統設定建立烘豆機。"}</Notice>
      ) : (
        <EntityForm
          draftKey={src ? undefined : "roast-new"}
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
            { name: "greenLotId", label: "生豆批次", type: "select", required: true, options: greens, section: "a", wide: true },
            { name: "roasterId", label: "烘豆機", type: "select", required: true, options: roasters.map((r) => ({ value: r.id, label: r.name })), section: "a" },
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
            { name: "copiedFromId", label: "", type: "hidden" },
          ]}
          action={createRoast}
        />
      )}
    </>
  );
}
