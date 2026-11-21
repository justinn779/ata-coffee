"use client";

import Link from "next/link";
import { D, fmtMoney } from "@/lib/decimal";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { useCol, useWhereIn, type Row } from "@/lib/data";
import { Guard, useQS, useQSList } from "@/lib/page";

/**
 * 出貨單／揀貨單列印。
 *   /print/orders/?ids=<id,id>        指定訂單
 *   /print/orders/?status=READY_TO_SHIP  所有可出貨訂單
 *   &type=picking 揀貨單（依 SKU＋批號彙總）；預設 packing 出貨單（每張訂單一頁）
 *   &price=1 出貨單顯示金額
 */
export default function PrintOrders() {
  const ids = useQSList("ids");
  const status = useQS("status");
  const type = useQS("type") === "picking" ? "picking" : "packing";
  const showPrice = useQS("price") === "1";
  const byStatus = useCol(status ? "orders" : null, [["fulfillmentStatus", status]], "orderNo", false);
  const byIds = useWhereIn(status ? null : "orders", "__id", ids);
  const orders = (status ? byStatus.data : byIds.data).filter((o) => o.fulfillmentStatus !== "CANCELLED").sort((a, b) => (a.orderNo < b.orderNo ? -1 : 1));
  const orderIds = orders.map((o) => o.id);
  const items = useWhereIn(orderIds.length ? "orderItems" : null, "orderId", orderIds);
  const allocs = useWhereIn(orderIds.length ? "allocations" : null, "orderId", orderIds);
  const variants = useCol("variants");
  const loading = byStatus.loading || byIds.loading || items.loading || allocs.loading || variants.loading;
  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    else p.set("ids", ids.join(","));
    p.set("type", type);
    if (showPrice) p.set("price", "1");
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
    return `/print/orders/?${p.toString()}`;
  };
  return (
    <Guard loading={loading} error={byStatus.error ?? byIds.error ?? items.error ?? allocs.error}>
      {() => {
        const activeAllocs = allocs.data.filter((a) => a.status !== "RELEASED");
        const vname = new Map(variants.data.map((v) => [v.id, `${v.productName}｜${v.name}`]));
        return (
          <>
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-4 py-3 text-sm print:hidden">
              <Link href={orders.length === 1 ? `/orders/view/?id=${orders[0].id}` : "/orders/?ful=READY_TO_SHIP"} className="text-neutral-600 underline">
                ← 返回
              </Link>
              <span className="mx-2 text-neutral-300">|</span>
              <Link href={qs({ type: "packing" })} className={type === "packing" ? "font-semibold" : "text-neutral-600 underline"}>
                出貨單
              </Link>
              <Link href={qs({ type: "picking" })} className={type === "picking" ? "font-semibold" : "text-neutral-600 underline"}>
                揀貨單
              </Link>
              {type === "packing" && (
                <Link href={qs({ price: showPrice ? null : "1" })} className="text-neutral-600 underline">
                  {showPrice ? "隱藏金額" : "顯示金額"}
                </Link>
              )}
              <span className="ml-auto text-neutral-500">共 {orders.length} 張訂單</span>
              <button type="button" onClick={() => window.print()} className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white">
                列印
              </button>
            </div>
            {!orders.length ? (
              <p className="p-8 text-center text-neutral-500">沒有可列印的訂單</p>
            ) : type === "picking" ? (
              <PickingList orders={orders} items={items.data} allocs={activeAllocs} vname={vname} />
            ) : (
              orders.map((o) => <PackingSlip key={o.id} order={o} items={items.data.filter((i) => i.orderId === o.id)} allocs={activeAllocs.filter((a) => a.orderId === o.id)} showPrice={showPrice} vname={vname} />)
            )}
          </>
        );
      }}
    </Guard>
  );
}

const th = "border-b-2 border-black px-2 py-1.5 text-left text-xs font-semibold";
const td = "border-b border-neutral-300 px-2 py-1.5 align-top";
const Box = () => <span className="inline-block h-4 w-4 border border-black" aria-hidden />;

function Header({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-5 flex items-end justify-between border-b-2 border-black pb-2">
      <div>
        <div className="font-serif text-xl font-semibold tracking-[0.15em]">ATA COFFEE</div>
        <div className="text-xs text-neutral-600">{sub}</div>
      </div>
      <div className="text-2xl font-semibold tracking-widest">{title}</div>
    </div>
  );
}

function PackingSlip({ order: o, items, allocs, showPrice, vname }: { order: Row; items: Row[]; allocs: Row[]; showPrice: boolean; vname: Map<string, string> }) {
  return (
    <section className="print-page mx-auto max-w-[190mm] px-6 py-8 text-[13px] leading-relaxed">
      <Header title="出貨單" sub={`列印時間 ${fmtDateTime(new Date())}`} />
      <div className="mb-5 grid grid-cols-2 gap-x-8 gap-y-1">
        <Field k="訂單編號" v={<b className="text-base">{o.orderNo}</b>} />
        <Field k="下單日期" v={fmtDate(o.orderedAt)} />
        <Field k="收件人" v={<b>{o.customerName}</b>} />
        <Field k="電話" v={o.customerPhone ?? "—"} />
        <div className="col-span-2">
          <Field k="地址" v={o.shippingAddress ?? "—"} />
        </div>
        <Field k="配送方式" v={o.shipment?.method ?? o.shippingMethod ?? "—"} />
        <Field k="追蹤號碼" v={o.shipment?.trackingNo ?? "＿＿＿＿＿＿＿＿"} />
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th + " w-8"}>✓</th>
            <th className={th}>SKU</th>
            <th className={th}>品名</th>
            <th className={th}>批號</th>
            <th className={th + " text-right"}>數量</th>
            {showPrice && <th className={th + " text-right"}>小計</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const lots = allocs.filter((a) => a.orderItemId === it.id);
            return (
              <tr key={it.id}>
                <td className={td}>
                  <Box />
                </td>
                <td className={td + " font-mono text-xs"}>{it.skuSnapshot}</td>
                <td className={td}>
                  {it.nameSnapshot}
                  {it.isBundle && <div className="text-xs text-neutral-600">套組內容：{((it.bundleComponents as Row[]) ?? []).map((c) => `${vname.get(c.variantId) ?? c.variantId}×${c.quantity * it.quantity}`).join("、")}</div>}
                </td>
                <td className={td + " font-mono text-xs"}>{lots.length ? lots.map((a) => <div key={a.id}>{a.lotCode}{lots.length > 1 || it.isBundle ? ` ×${D(a.quantity).toString()}` : ""}</div>) : "—"}</td>
                <td className={td + " text-right text-base font-semibold"}>{it.quantity}</td>
                {showPrice && <td className={td + " text-right"}>{fmtMoney(it.lineTotal)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-3 flex justify-between text-sm">
        <span>合計 {items.reduce((s, i) => s + Number(i.quantity), 0)} 件</span>
        {showPrice && (
          <span>
            運費 {fmtMoney(o.shippingFee)}　<b>訂單總額 {fmtMoney(o.total)}</b>
          </span>
        )}
      </div>
      {o.note && (
        <div className="mt-4 rounded border border-neutral-400 p-2 text-sm">
          <b>備註：</b>
          <span className="whitespace-pre-line">{o.note}</span>
        </div>
      )}
      <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
        <div className="border-t border-black pt-1">揀貨人</div>
        <div className="border-t border-black pt-1">包裝確認</div>
      </div>
      <p className="mt-8 text-center text-xs text-neutral-500">感謝您的支持，祝您享用愉快 ☕</p>
    </section>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-neutral-600">{k}</span>
      <span>{v}</span>
    </div>
  );
}

/** 揀貨單：所有選取訂單的品項，依 SKU＋批號彙總，附訂單編號方便分裝 */
function PickingList({ orders, items, allocs, vname }: { orders: Row[]; items: Row[]; allocs: Row[]; vname: Map<string, string> }) {
  const no = new Map(orders.map((o) => [o.id, o.orderNo as string]));
  const rows = new Map<string, { sku: string; name: string; lot: string; qty: number; orders: Map<string, number> }>();
  const add = (sku: string, name: string, lot: string, qty: number, orderId: string) => {
    const k = `${sku}|${lot}`;
    const r = rows.get(k) ?? { sku, name, lot, qty: 0, orders: new Map() };
    r.qty += qty;
    r.orders.set(no.get(orderId) ?? "", (r.orders.get(no.get(orderId) ?? "") ?? 0) + qty);
    rows.set(k, r);
  };
  for (const a of allocs) add(a.sku, vname.get(a.variantId) ?? a.sku, a.lotCode, Number(a.quantity), a.orderId);
  // 未追蹤庫存的品項沒有批號分配
  for (const it of items.filter((i) => i.fulfillmentMode === "NOT_TRACKED")) add(it.skuSnapshot, it.nameSnapshot, "—", Number(it.quantity), it.orderId);
  // 尚未分配到批次的數量（例如接單後分裝尚未完成）
  for (const it of items.filter((i) => i.fulfillmentMode !== "NOT_TRACKED" && !i.isBundle)) {
    const got = allocs.filter((a) => a.orderItemId === it.id).reduce((s, a) => s + Number(a.quantity), 0);
    if (got < it.quantity) add(it.skuSnapshot, it.nameSnapshot, "（待分裝）", it.quantity - got, it.orderId);
  }
  const list = [...rows.values()].sort((a, b) => (a.sku === b.sku ? (a.lot < b.lot ? -1 : 1) : a.sku < b.sku ? -1 : 1));
  return (
    <section className="print-page mx-auto max-w-[190mm] px-6 py-8 text-[13px]">
      <Header title="揀貨單" sub={`${orders.length} 張訂單 · 列印時間 ${fmtDateTime(new Date())}`} />
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th + " w-8"}>✓</th>
            <th className={th}>SKU</th>
            <th className={th}>品名</th>
            <th className={th}>批號</th>
            <th className={th + " text-right"}>數量</th>
            <th className={th}>訂單</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={`${r.sku}|${r.lot}`}>
              <td className={td}>
                <Box />
              </td>
              <td className={td + " font-mono text-xs"}>{r.sku}</td>
              <td className={td}>{r.name}</td>
              <td className={td + " font-mono text-xs"}>{r.lot}</td>
              <td className={td + " text-right text-base font-semibold"}>{r.qty}</td>
              <td className={td + " text-xs"}>{[...r.orders].map(([n, q]) => `${n}×${q}`).join("、")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-sm">合計 {list.reduce((s, r) => s + r.qty, 0)} 件（套組已展開為組件）</p>
    </section>
  );
}
