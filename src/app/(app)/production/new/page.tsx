"use client";

import { useSearchParams } from "next/navigation";
import { todayTaipei } from "@/lib/time";
import { opAction } from "@/lib/api";
import { useQS, useRoastedLotOptions, useVariantOptions, withNext } from "@/lib/page";
import { EntityForm } from "@/components/entity-form";
import { LinkButton, Notice, PageHeader } from "@/components/ui";

/**
 * 分裝（一步完成）：選熟豆批次、要裝成的商品規格、包數，按下去就扣熟豆與包材、產出成品。
 * ?lot= 預選熟豆批次，?variant= 預選規格，?coffee= 只列這支豆子的熟豆。
 */
export default function NewPO() {
  const lot = useQS("lot");
  const coffee = useQS("coffee");
  const sp = useSearchParams();
  const variant = useQS("variant");
  const lots = useRoastedLotOptions(coffee);
  const variants = useVariantOptions({ includeBundles: false });
  const here = `/production/new/${sp.toString() ? `?${sp.toString()}` : ""}`;
  return (
    <>
      <PageHeader title="分裝" description="把烘好的熟豆裝成一包包商品。選熟豆、要裝成哪個規格、裝幾包，按「完成分裝」就會扣熟豆和袋子、產生成品庫存。" back={{ href: "/production/", label: "分裝紀錄" }} />
      {lots.length === 0 ? (
        <Notice tone="warning">
          <span className="flex flex-wrap items-center justify-between gap-3">
            {coffee ? "這支豆子還沒有熟豆，先烘一批，完成後會回到這裡。" : "還沒有熟豆批次，先烘一批。"}
            <LinkButton size="sm" href={withNext(coffee ? `/roasting/new/?coffee=${coffee}` : "/roasting/new/", here)}>
              ＋ 新增烘豆
            </LinkButton>
          </span>
        </Notice>
      ) : variants.length === 0 ? (
        <Notice tone="warning">
          <span className="flex flex-wrap items-center justify-between gap-3">
            還沒有商品規格（例：耶加雪菲 100g），先建立商品。
            <LinkButton size="sm" href="/products/new/">
              ＋ 新增商品
            </LinkButton>
          </span>
        </Notice>
      ) : (
        <EntityForm
          key={`${lots.length}-${variants.length}`}
          draftKey="pack-quick"
          submitLabel="完成分裝"
          successMessage="分裝完成"
          defaultValues={{ sourceLotId: lot ?? "", targetVariantId: variant ?? "", packedDate: todayTaipei() }}
          fields={[
            { name: "sourceLotId", label: "用哪批熟豆", type: "select", required: true, options: lots, wide: true },
            { name: "targetVariantId", label: "裝成哪個商品規格", type: "select", required: true, options: variants, wide: true },
            { name: "qty", label: "裝了幾包", type: "number", unit: "包", required: true },
            { name: "packedDate", label: "分裝日期", type: "date", required: true },
            { name: "fillWeightG", label: "每包重量（選填）", type: "number", unit: "g", hint: "留空用商品規格設定的重量" },
            { name: "lossG", label: "損耗（選填）", type: "number", unit: "g", hint: "灑出、試喝等額外用掉的熟豆" },
            { name: "note", label: "備註", type: "textarea", wide: true },
          ]}
          action={opAction("production.quick", undefined, (d) => `/production/view/?id=${d.id}`)}
        />
      )}
    </>
  );
}
