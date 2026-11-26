"use client";

import { Suspense } from "react";
import { useCol, useDocument } from "@/lib/data";
import { callOp } from "@/lib/api";
import { useQS, useVariantOptions, Loading } from "@/lib/page";
import { EntityForm } from "@/components/entity-form";
import { ActionDialog } from "@/components/action-dialog";
import { Badge, Card, CardHeader, LinkButton, PageHeader, SimpleTable, A } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";
import { local } from "../_shared";

const STATUS: Record<string, string> = { ACTIVE: "接單中", PAUSED: "暫停", CLOSED: "已結束" };

/**
 * 預購活動：接單上限與預計出貨日由管理員設定；配額與實體庫存分開計算。
 * 到貨後在訂單頁按「分配預購商品」，就會用成品或接單後分裝，與現貨一起出貨。
 */
function List() {
  const cs = useCol("preorderCampaigns", [], "createdAt");
  return (
    <>
      <PageHeader title="預購" description="預購期間前台只看接單上限，不動用實體庫存；付款後轉為已確認" actions={<LinkButton href="/store/preorders/?id=new">＋ 新增預購</LinkButton>} />
      <Card>
        <SimpleTable
          head={["活動", "規格", "已確認", "待付款", "上限", "預計出貨", "期間", "狀態", ""]}
          rows={cs.data.map((c) => [
            <A key="n" href={`/store/preorders/?id=${c.id}`}>
              {c.name}
            </A>,
            c.variantName,
            c.confirmedQty ?? 0,
            c.reservedQty ?? 0,
            c.cap,
            <span key="d">
              {c.shipDate}
              {c.originalShipDate && c.originalShipDate !== c.shipDate && <span className="ml-1 text-xs text-muted">（原 {c.originalShipDate}）</span>}
            </span>,
            `${c.startAt ? fmtDateTime(c.startAt) : "立即"} ～ ${c.endAt ? fmtDateTime(c.endAt) : "不限"}`,
            <Badge key="s" tone={c.status === "ACTIVE" ? "sage" : "neutral"}>
              {STATUS[c.status]}
            </Badge>,
            <ActionDialog key="x" label="延期" size="sm" variant="outline" title={`延後出貨：${c.name}`} description="會更新所有相關訂單的預計出貨日（保留原始承諾日），並寄信通知顧客。" fields={[{ name: "shipDate", label: "新的預計出貨日", type: "date", required: true }, { name: "note", label: "給顧客的說明", type: "textarea" }]} payload={{ id: c.id }} action={(i) => callOp("store.preorder.delay", i)} successMessage="已延期並通知顧客" />,
          ])}
          empty="還沒有預購活動"
        />
      </Card>
    </>
  );
}

function Edit({ id }: { id: string }) {
  const isNew = id === "new";
  const c = useDocument("preorderCampaigns", isNew ? null : id);
  const variants = useVariantOptions({ includeBundles: false });
  if ((!isNew && c.loading) || !variants.length) return <Loading />;
  const d = c.data;
  return (
    <>
      <PageHeader title={isNew ? "新增預購" : `預購：${d?.name}`} back={{ href: "/store/preorders/", label: "預購" }} />
      <Card>
        <CardHeader title="活動設定" description={isNew ? undefined : "要更改預計出貨日請回列表按「延期」，系統會通知已下單的顧客"} />
        <div className="p-4">
          <EntityForm
            key={`${variants.length}-${d?.id ?? "new"}`}
            submitLabel="儲存"
            defaultValues={{ variantId: d?.variantId ?? "", name: d?.name ?? "", startAt: local(d?.startAt), endAt: local(d?.endAt), cap: String(d?.cap ?? ""), shipDate: d?.shipDate ?? "", status: d?.status ?? "ACTIVE" }}
            fields={[
              { name: "variantId", label: "預購的規格", type: "select", options: variants, required: true, wide: true },
              { name: "name", label: "活動名稱（後台用）", placeholder: "例：新產季肯亞預購" },
              { name: "cap", label: "接單上限", type: "number", unit: "件", required: true },
              { name: "shipDate", label: "預計出貨日", type: "date", required: true },
              { name: "startAt", label: "開始時間（留空＝立即）", type: "datetime" },
              { name: "endAt", label: "結束時間（留空＝不限）", type: "datetime" },
              { name: "status", label: "狀態", type: "select", options: Object.entries(STATUS).map(([value, label]) => ({ value, label })), required: true },
            ]}
            action={async (v) => {
              const r = await callOp("store.preorder.save", { ...v, id: isNew ? null : id, cap: Number(v.cap) });
              return r.ok ? { ...r, data: { redirect: "/store/preorders/" } } : r;
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
export default function Preorders() {
  return (
    <Suspense fallback={<Loading />}>
      <Page />
    </Suspense>
  );
}
