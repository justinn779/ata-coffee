"use server";

import { z } from "zod";
import { prisma, withTx } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { boolStr, optDate, optDec, optEmail, optId, optStr, reqDec, reqId, reqInt, reqStr } from "@/lib/zod";
import { action } from "@/server/action";
import { audit } from "@/server/domain/audit";
import { nextNumber } from "@/server/domain/sequence";
import {
  addOrderCost,
  cancelOrder,
  completeOrder,
  confirmPayment,
  createOrder,
  createReturn,
  inspectReturnItem,
  markPaymentPending,
  recordRefund,
  shipOrder,
} from "@/server/domain/orders";

const R = ["/orders", "/inventory", "/production", "/"];

export const createManualOrder = action(
  z.object({
    customerId: optId(),
    customerName: optStr(100),
    customerPhone: optStr(50),
    customerEmail: optStr(200),
    shippingAddress: optStr(500),
    shippingMethod: optStr(100),
    shippingFee: optDec("運費", { min: 0 }),
    note: optStr(),
    idempotencyKey: z.string().max(100).optional(),
    items: z.array(z.object({ variantId: reqId("商品"), quantity: reqInt("數量"), discount: optDec("折扣", { min: 0 }) })).min(1, "至少需要一項商品"),
  }),
  async (i, actor) => {
    let name = i.customerName;
    let phone = i.customerPhone;
    let email = i.customerEmail;
    let addr = i.shippingAddress;
    if (i.customerId) {
      const c = await prisma.customer.findUniqueOrThrow({ where: { id: i.customerId } });
      name ||= c.name;
      phone ||= c.phone;
      email ||= c.email;
      addr ||= c.address;
    }
    if (!name) throw new DomainError("請選擇顧客或填寫顧客名稱");
    const { order } = await withTx((tx) =>
      createOrder(
        tx,
        { ...i, customerName: name!, customerPhone: phone, customerEmail: email, shippingAddress: addr, shippingFee: i.shippingFee ?? 0, items: i.items.map((x) => ({ ...x, discount: x.discount ?? 0 })) },
        actor,
      ),
    );
    return { id: order.id, redirect: `/orders/${order.id}` };
  },
  { revalidate: R },
);

const idOnly = z.object({ orderId: reqId("訂單") });

export const confirmPaymentAction = action(
  idOnly.extend({ method: z.enum(["BANK_TRANSFER", "CASH", "CARD", "OTHER"]).default("BANK_TRANSFER"), reference: optStr(100), note: optStr(500) }),
  async ({ orderId, ...i }, actor) => {
    const r = await withTx((tx) => confirmPayment(tx, orderId, i, actor));
    return { ok: true as const, message: r.alreadyPaid ? "此訂單先前已確認付款，未重複記錄" : "已確認付款" };
  },
  { revalidate: R },
);

export const markPendingAction = action(idOnly.extend({ reference: optStr(100) }), async ({ orderId, reference }, actor) => {
  await withTx((tx) => markPaymentPending(tx, orderId, actor, reference ?? undefined));
  return { ok: true as const, message: "已標記為待確認" };
}, { revalidate: R });

export const shipAction = action(
  idOnly.extend({ carrier: optStr(100), trackingNo: optStr(100), method: optStr(100), shippingCost: optDec("物流成本", { min: 0 }), note: optStr(500) }),
  async ({ orderId, ...i }, actor) => {
    await withTx((tx) => shipOrder(tx, orderId, { ...i, shippingCost: i.shippingCost ?? undefined }, actor));
    return { ok: true as const, message: "已出貨並扣除成品庫存" };
  },
  { revalidate: R },
);

export const completeAction = action(idOnly, async ({ orderId }, actor) => {
  await withTx((tx) => completeOrder(tx, orderId, actor));
  return { ok: true as const, message: "訂單已完成" };
}, { revalidate: R });

export const cancelAction = action(idOnly.extend({ reason: optStr(300), refundAmount: optDec("退款金額", { min: 0 }) }), async ({ orderId, ...i }, actor) => {
  await withTx((tx) => cancelOrder(tx, orderId, i, actor));
  return { ok: true as const, message: "訂單已取消，保留已釋放" };
}, { revalidate: R });

export const refundAction = action(idOnly.extend({ amount: reqDec("退款金額", { positive: true }), reference: optStr(100), note: optStr(500) }), async ({ orderId, ...i }, actor) => {
  await withTx((tx) => recordRefund(tx, orderId, i, actor));
  return { ok: true as const, message: "已記錄退款" };
}, { revalidate: R });

export const returnAction = action(
  idOnly.extend({ reason: optStr(500), items: z.string().min(2, "請選擇退貨品項") }),
  async ({ orderId, reason, items }, actor) => {
    // items 格式：allocationId:qty,allocationId:qty
    const parsed = items.split(",").map((s) => s.split(":")).filter(([a, q]) => a && Number(q) > 0).map(([allocationId, quantity]) => ({ allocationId, quantity }));
    if (!parsed.length) throw new DomainError("請至少輸入一項退貨數量");
    await withTx((tx) => createReturn(tx, orderId, { reason, items: parsed }, actor));
    return { ok: true as const, message: "已建立退貨，商品進入待檢庫存（不可售）" };
  },
  { revalidate: R },
);

export const inspectAction = action(z.object({ returnItemId: reqId("退貨明細"), disposition: z.enum(["RESTOCK", "SCRAP"]), note: optStr(300) }), async (i, actor) => {
  await withTx((tx) => inspectReturnItem(tx, i.returnItemId, i.disposition, actor, i.note ?? undefined));
  return { ok: true as const, message: i.disposition === "RESTOCK" ? "檢查合格，已重新入庫" : "已報廢" };
}, { revalidate: R });

export const orderCostAction = action(
  idOnly.extend({ category: z.enum(["SHIPPING", "PLATFORM_FEE", "PAYMENT_FEE", "ORDER_OTHER"]), amount: reqDec("金額", { positive: true }), isEstimate: boolStr(), calcNote: optStr(300) }),
  async ({ orderId, ...i }, actor) => {
    await withTx((tx) => addOrderCost(tx, orderId, i, actor));
    return { ok: true as const, message: "已新增訂單直接成本" };
  },
  { revalidate: R },
);

// ── 顧客 ──
export const saveCustomer = action(
  z.object({ id: optId(), name: reqStr("顧客名稱", 100), phone: optStr(50), email: optEmail(), address: optStr(500), note: optStr(), birthday: optDate() }),
  async ({ id, birthday: _b, ...data }, actor) => {
    void _b;
    const c = await withTx(async (tx) => {
      const c = id ? await tx.customer.update({ where: { id }, data }) : await tx.customer.create({ data: { ...data, code: await nextNumber(tx, "C", { daily: false, pad: 4 }) } });
      await audit(tx, actor, id ? "customer.update" : "customer.create", "Customer", c.id, c.code);
      return c;
    });
    return { id: c.id, redirect: `/customers/${c.id}` };
  },
  { revalidate: ["/customers"] },
);
