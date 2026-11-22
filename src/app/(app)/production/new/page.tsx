"use client";

import { todayTaipei } from "@/lib/time";
import { opAction } from "@/lib/api";
import { useQS, useRoastedLotOptions, useVariantOptions } from "@/lib/page";
import { EntityForm } from "@/components/entity-form";
import { Notice, PageHeader } from "@/components/ui";

export default function NewPO() {
  const lot = useQS("lot");
  const variant = useQS("variant");
  const lots = useRoastedLotOptions();
  const variants = useVariantOptions({ includeBundles: false });
  return (
    <>
      <PageHeader title="新增分裝單（預先分裝）" description="建立後即預留熟豆：計畫數量 × 單包重量。接單後分裝由訂單自動建立。" back={{ href: "/production/", label: "分裝生產" }} />
      {lots.length === 0 ? (
        <Notice tone="warning">沒有可用的熟豆批次。</Notice>
      ) : (
        <EntityForm
          key={`${lots.length}-${variants.length}`}
          draftKey="po-new"
          submitLabel="建立分裝單並預留熟豆"
          defaultValues={{ sourceLotId: lot ?? "", targetVariantId: variant ?? "", plannedDate: todayTaipei() }}
          fields={[
            { name: "sourceLotId", label: "熟豆批次（單一來源，不混批）", type: "select", required: true, options: lots, wide: true },
            { name: "targetVariantId", label: "目標品項", type: "select", required: true, options: variants, wide: true },
            { name: "plannedQty", label: "預計生產數量", type: "number", unit: "件", required: true },
            { name: "fillWeightG", label: "單包填充重量", type: "number", unit: "g", hint: "留空使用品項預設；濾掛可自訂" },
            { name: "plannedDate", label: "生產日期", type: "date", required: true },
            { name: "note", label: "備註", type: "textarea", wide: true },
          ]}
          action={opAction("production.create", undefined, (d) => `/production/view/?id=${d.id}`)}
        />
      )}
    </>
  );
}
