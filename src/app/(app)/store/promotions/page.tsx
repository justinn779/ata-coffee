"use client";

import { Suspense } from "react";
import { useCol, useDocument } from "@/lib/data";
import { callOp } from "@/lib/api";
import { useQS, Loading } from "@/lib/page";
import { EntityForm } from "@/components/entity-form";
import { Badge, Card, CardHeader, LinkButton, Notice, PageHeader, SimpleTable, A } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";
import { local, PROMO_TYPE } from "../_shared";

/**
 * 優惠：折扣碼、固定金額、百分比、滿額、免運、組合優惠。每個優惠各自設定能否與其他優惠併用。
 * 計算順序：商品小計 → 商品／組合優惠 → 訂單優惠 → 運費與免運 → 應付金額。
 * 同時符合多個優惠時，系統自動選對顧客最划算、且符合併用規則的組合（結果固定，不受設定順序影響）。
 */
function List() {
  const ps = useCol("promotions", [], "createdAt");
  return (
    <>
      <PageHeader title="優惠" description="折扣碼、滿額折、免運、組合優惠；可設定期間、使用次數與能否併用" actions={<LinkButton href="/store/promotions/?id=new">＋ 新增優惠</LinkButton>} />
      <Card>
        <SimpleTable
          head={["名稱", "折扣碼", "類型", "內容", "期間", "已使用", "併用", "狀態"]}
          rows={ps.data.map((p) => [
            <A key="n" href={`/store/promotions/?id=${p.id}`}>
              {p.name}
            </A>,
            p.code ? <span className="font-mono">{p.code}</span> : <span className="text-muted">自動套用</span>,
            PROMO_TYPE[p.type],
            p.type === "PERCENT" ? `${p.value}%` : p.type === "FREE_SHIPPING" ? "免運" : p.type === "COMBO" ? `每 ${p.comboQty} 件折 ${p.value}` : `折 ${p.value}`,
            `${p.startAt ? fmtDateTime(p.startAt) : "即日起"} ～ ${p.endAt ? fmtDateTime(p.endAt) : "不限"}`,
            `${p.usedCount ?? 0}${p.usageLimit ? ` / ${p.usageLimit}` : ""}`,
            p.stackable ? "可" : "不可",
            <Badge key="s" tone={p.active ? "sage" : "neutral"}>
              {p.active ? "啟用" : "停用"}
            </Badge>,
          ])}
          empty="還沒有優惠"
        />
      </Card>
    </>
  );
}

function Edit({ id }: { id: string }) {
  const isNew = id === "new";
  const p = useDocument("promotions", isNew ? null : id);
  const products = useCol("products", [], "createdAt");
  if ((!isNew && p.loading) || products.loading) return <Loading />;
  const d = p.data;
  const prodOpts = products.data.map((x) => ({ value: x.id, label: x.name }));
  return (
    <>
      <PageHeader title={isNew ? "新增優惠" : `優惠：${d?.name}`} back={{ href: "/store/promotions/", label: "優惠" }} />
      <Notice tone="info">沒填折扣碼＝符合條件自動套用。「可併用」的優惠會一起計算；「不可併用」的優惠只會單獨使用，系統會自動選對顧客最划算的方案。</Notice>
      <Card className="mt-4">
        <CardHeader title="優惠設定" />
        <div className="p-4">
          <EntityForm
            key={`${products.data.length}-${d?.id ?? "new"}`}
            submitLabel="儲存"
            defaultValues={{
              name: d?.name ?? "",
              code: d?.code ?? "",
              active: d?.active ?? true,
              type: d?.type ?? "AMOUNT",
              value: d?.value ?? "",
              appliesTo: d?.appliesTo ?? "ALL",
              productIds: (d?.productIds ?? []).map((x: string) => ({ productId: x })),
              minSpend: d?.minSpend ?? "",
              comboQty: d?.comboQty ?? "",
              maxDiscount: d?.maxDiscount ?? "",
              usageLimit: d?.usageLimit ?? "",
              perCustomerLimit: d?.perCustomerLimit ?? "",
              priority: String(d?.priority ?? 0),
              stackable: d?.stackable ?? true,
              startAt: local(d?.startAt),
              endAt: local(d?.endAt),
            }}
            sections={[
              { key: "a", title: "折扣" },
              { key: "b", title: "條件與限制" },
            ]}
            fields={[
              { name: "name", label: "名稱（顧客會看到）", required: true, section: "a" },
              { name: "code", label: "折扣碼（留空＝自動套用）", placeholder: "例：WELCOME100", section: "a" },
              { name: "type", label: "類型", type: "select", options: Object.entries(PROMO_TYPE).map(([value, label]) => ({ value, label })), required: true, section: "a" },
              { name: "value", label: "折扣（金額或百分比數字）", type: "number", hint: "固定金額：折幾元；百分比：填 10 代表 9 折；組合：每組折幾元；免運不用填", section: "a" },
              { name: "maxDiscount", label: "最多折抵（選填）", type: "number", unit: "元", section: "a" },
              { name: "stackable", label: "可以和其他優惠併用", type: "checkbox", section: "a" },
              { name: "active", label: "啟用", type: "checkbox", section: "a" },
              { name: "appliesTo", label: "適用範圍", type: "select", options: [{ value: "ALL", label: "全部商品（訂單折扣）" }, { value: "PRODUCTS", label: "指定商品（商品折扣）" }], section: "b" },
              { name: "productIds", label: "指定商品", type: "array", section: "b", addLabel: "加一個商品", newItem: { productId: "" }, itemFields: [{ name: "productId", label: "商品", type: "select", options: prodOpts }] },
              { name: "comboQty", label: "組合件數（組合優惠：每買幾件算一組）", type: "number", section: "b" },
              { name: "minSpend", label: "最低消費（選填）", type: "number", unit: "元", section: "b" },
              { name: "usageLimit", label: "總使用次數上限（選填）", type: "number", section: "b" },
              { name: "perCustomerLimit", label: "每位顧客可用次數（選填）", type: "number", section: "b" },
              { name: "priority", label: "優先順序（同額時數字大者優先）", type: "number", section: "b" },
              { name: "startAt", label: "開始時間（留空＝立即）", type: "datetime", section: "b" },
              { name: "endAt", label: "結束時間（留空＝不限）", type: "datetime", section: "b" },
            ]}
            action={async (v) => {
              const productIds = ((v.productIds as Array<{ productId: string }>) ?? []).map((x) => x.productId).filter(Boolean);
              const r = await callOp("store.promotion.save", { ...v, id: isNew ? null : id, productIds, variantIds: d?.variantIds ?? [], active: !!v.active, stackable: !!v.stackable, priority: Number(v.priority) || 0 });
              return r.ok ? { ...r, data: { redirect: "/store/promotions/" } } : r;
            }}
          />
        </div>
      </Card>
    </>
  );
}

function Page() {
  const id = useQS("id");
  return id ? <Edit id={id} /> : <List />;
}
export default function Promotions() {
  return (
    <Suspense fallback={<Loading />}>
      <Page />
    </Suspense>
  );
}
