/**
 * 前台輸出：把內部訂單轉成顧客看得懂的訂單進度（不輸出成本、批次、內部備註、稽核資料）。
 */
import { D } from "../../../src/lib/decimal";
import type { Doc } from "../tx";
import { C } from "../types";
import type { Reader } from "./catalog";

const n0 = (v: unknown) => D((v as string) ?? 0).toDecimalPlaces(0).toFixed(0);

/** 訂單狀態（由付款與履約狀態推導，不會跟另外兩個維度不一致） */
export function orderStatusOf(o: Doc) {
  const f = o.fulfillmentStatus as string;
  if (f === "CANCELLED") return "CANCELLED";
  if (["COMPLETED", "PICKED_UP"].includes(f)) return "COMPLETED";
  if (["PAID", "PARTIALLY_REFUNDED", "REFUND_PENDING", "REFUNDED"].includes(o.paymentStatus as string) || ["SHIPPED", "ARRIVED", "LOGISTICS_ISSUE", "RETURNED_UNCLAIMED", "RETURN_PROCESSING"].includes(f)) return "PROCESSING";
  return "PENDING";
}

/** 顧客看到的進度：付款 → 備貨 → 出貨 → 到店 → 取貨 */
export function progressOf(o: Doc) {
  const f = o.fulfillmentStatus as string;
  const p = o.paymentStatus as string;
  const paid = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED", "REFUND_PENDING"].includes(p);
  const shipped = ["SHIPPED", "ARRIVED", "PICKED_UP", "COMPLETED", "LOGISTICS_ISSUE", "RETURNED_UNCLAIMED", "RETURN_PROCESSING"].includes(f);
  const steps = [
    { key: "placed", label: "訂單成立", done: true },
    { key: "paid", label: p === "PENDING_CONFIRMATION" || p === "UNDER_REVIEW" ? "付款確認中" : "付款確認", done: paid },
    { key: "preparing", label: "備貨中", done: shipped },
    { key: "shipped", label: "已出貨", done: shipped },
    { key: "arrived", label: "已到店", done: ["ARRIVED", "PICKED_UP", "COMPLETED"].includes(f) },
    { key: "picked", label: "已取貨", done: ["PICKED_UP", "COMPLETED"].includes(f) },
  ];
  // 狀態說明（一句話）
  let headline = "";
  if (f === "CANCELLED") headline = p === "EXPIRED" ? "已逾期取消" : "已取消";
  else if (p === "UNPAID") headline = "等待付款";
  else if (p === "REJECTED") headline = "付款資訊需要確認";
  else if (p === "PENDING_CONFIRMATION" || p === "UNDER_REVIEW") headline = "付款確認中";
  else if (p === "REFUND_PENDING") headline = "退款處理中";
  else if (p === "REFUNDED") headline = "已退款";
  else if (f === "LOGISTICS_ISSUE") headline = "物流處理中";
  else if (f === "RETURNED_UNCLAIMED") headline = "未取貨退回";
  else if (["PICKED_UP", "COMPLETED"].includes(f)) headline = "已完成";
  else if (f === "ARRIVED") headline = "已到店，請取貨";
  else if (f === "SHIPPED") headline = "已出貨";
  else headline = (o.store as Doc | undefined)?.hasPreorder && f === "AWAITING_PACKAGING" ? "預購準備中" : "備貨中";
  return { steps, headline };
}

const maskEmail = (e: unknown) => {
  const [u, d] = String(e ?? "").split("@");
  return d ? `${u.slice(0, 2)}${"•".repeat(Math.max(1, u.length - 2))}@${d}` : "";
};
const maskPhone = (p: unknown) => {
  const s = String(p ?? "");
  return s.length > 6 ? `${s.slice(0, 4)}•••${s.slice(-3)}` : s;
};

export async function publicOrder(r: Reader, o: Doc, opts?: { full?: boolean }) {
  const st = (o.store ?? {}) as Doc;
  const items = await r.query(C.orderItems, [["orderId", "==", o.id]]);
  const reports = (await r.query(C.paymentReports, [["orderId", "==", o.id]])).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const p = o.paymentStatus as string;
  const f = o.fulfillmentStatus as string;
  const unpaid = ["UNPAID", "REJECTED"].includes(p) && f !== "CANCELLED";
  const ship = (o.shipment ?? null) as Doc | null;
  const pk = (st.pickup ?? {}) as Doc;
  return {
    id: o.id,
    orderNo: o.orderNo,
    createdAt: o.orderedAt,
    status: orderStatusOf(o),
    paymentStatus: p,
    fulfillmentStatus: f,
    ...progressOf(o),
    items: items.map((i) => ({ name: String(i.nameSnapshot), image: (i.imageSnapshot as string) ?? null, qty: Number(i.quantity), unitPrice: n0(i.unitPriceSnapshot), lineTotal: n0(i.lineTotal), grind: (i.grind as { label: string } | null)?.label ?? null, preorder: i.fulfillmentMode === "PREORDER" || !!i.campaignId, bundle: i.customBundle ? (i.bundleComponents as Array<{ name?: string; quantity: number }>).map((b) => ({ name: b.name ?? "", quantity: b.quantity })) : null })),
    itemsGross: n0(st.itemsGross ?? o.subtotal),
    discount: n0(o.discountTotal),
    promotions: (st.promotions as Array<{ name: string; amount: string }>) ?? [],
    shippingFee: n0(o.shippingFee),
    total: n0(o.total),
    refunded: n0(o.refundedTotal),
    estShipDate: st.estShipDate ?? null,
    originalEstShipDate: st.originalEstShipDate !== st.estShipDate ? (st.originalEstShipDate ?? null) : null,
    pickup: { carrier: pk.carrier, carrierLabel: pk.carrierLabel, storeId: pk.storeId, storeName: pk.storeName, storeAddress: pk.storeAddress ?? null },
    contact: opts?.full ? { name: o.customerName, phone: o.customerPhone, email: o.customerEmail } : { name: o.customerName, phone: maskPhone(o.customerPhone), email: maskEmail(o.customerEmail) },
    payment: unpaid ? { deadline: st.paymentDeadline, bank: st.bank, amount: n0(o.total) } : null,
    lastReport: reports[0] ? { last5: reports[0].last5, at: reports[0].createdAt, status: reports[0].status, reason: reports[0].rejectReason ?? null } : null,
    shipment: ship ? { carrier: ship.carrier ?? pk.carrierLabel ?? null, trackingNo: ship.trackingNo ?? null, shippedAt: ship.shippedAt ?? null } : null,
    canCancel: p === "UNPAID" && ["PENDING", "AWAITING_PACKAGING", "READY_TO_SHIP"].includes(f),
    canReport: unpaid || p === "PENDING_CONFIRMATION",
    note: o.note ?? null,
  };
}
