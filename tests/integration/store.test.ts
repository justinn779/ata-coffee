/**
 * 官方商城：下單、庫存保留（不超賣、不混豆、不重複扣熟豆）、預購、優惠、付款回報、逾期、訪客存取、會員權限。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { C } from "../../functions/src/types";
import { runShopOp, type ShopCtx } from "../../functions/src/shop/ops";
import { processOutbox, type NotificationProvider, type Rendered } from "../../functions/src/shop/outbox";
import { expireOne } from "../../functions/src/shop/orders";
import { runTx } from "../../functions/src/tx";
import { baseFixture, db, docs, expectReconciled, lotOf, n, op, packageUnits, receiveGreen, resetDb, roast } from "../helpers";

const sent: Rendered[] = [];
const provider: NotificationProvider = { channel: "EMAIL", name: "test", send: async (m) => void sent.push(m) };
type Who = ShopCtx["who"];
const guest: Who = { uid: null };
let ipSeq = 0;
const shop = <T = Record<string, any>>(name: string, input: unknown, who: Who = guest) => runShopOp(name, input, { db, who, ip: `t${ipSeq++}`, provider, allowMock: true }) as Promise<T>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
});

const contact = { name: "王小明", phone: "0912345678", email: "buyer@example.test" };
const pickup = { carrier: "SEVEN", storeId: "123456", storeName: "測試門市" };

async function storeFixture(opts?: { finished?: number; roastedG?: number }) {
  const f = await baseFixture();
  await op("store.product.save", { productId: f.product.id, status: "ACTIVE", slug: "yirgacheffe", flavor: "柑橘、花香", summary: "", images: [{ url: "https://example.test/a.jpg", alt: "" }], details: [], grindable: true, sortOrder: 0 });
  const g = await receiveGreen(f.coffee.id);
  const rb = await roast(g.id, f.roaster.id, 800, opts?.roastedG ?? 680);
  let fg: string | null = null;
  if (opts?.finished) fg = (await packageUnits(rb.roastedLotId, f.v100.id, opts.finished)).lotId;
  return { ...f, roastedLotId: rb.roastedLotId, fgLotId: fg, green: g };
}

async function quote(lines: unknown[], couponCode?: string | null, who: Who = guest) {
  return (await shop<{ quote: Record<string, any> }>("cart.quote", { lines, couponCode }, who)).quote; // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function place(lines: unknown[], extra?: Record<string, unknown>, who: Who = guest) {
  const q = await quote(lines, (extra?.couponCode as string) ?? null, who);
  return shop<{ orderNo: string; token: string; orderId: string; duplicate: boolean }>("order.create", { lines, contact, pickup, agree: true, signature: q.signature, idempotencyKey: `k-${Math.random()}-${Date.now()}`, ...extra }, who);
}

describe("商城下單與庫存", () => {
  it("訪客購買現貨：後端計價、保留成品、寄出訂單成立信、訂單連結可查詢", async () => {
    const f = await storeFixture({ finished: 3 });
    const q = await quote([{ variantId: f.v100.id, qty: 2 }]);
    expect(q.itemsGross).toBe("840");
    expect(q.shippingFee).toBe("60"); // 示範設定：運費 60、滿 1500 免運
    expect(q.total).toBe("900");
    const r = await place([{ variantId: f.v100.id, qty: 2 }]);
    expect(r.orderNo).toMatch(/^SO-/);
    const o = (await docs(C.orders))[0];
    expect(o.channel).toBe("STORE");
    expect(o.total).toBe("900.00");
    expect(n((await lotOf(f.fgLotId!)).reserved)).toBe(2);
    expect(sent.some((m) => m.subject.includes("訂單成立"))).toBe(true);
    const got = await shop<{ order: Record<string, any> }>("order.get", { token: r.token }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(got.order.orderNo).toBe(r.orderNo);
    expect(got.order.payment.bank.accountNo).toBeTruthy();
    expect(JSON.stringify(got.order)).not.toMatch(/costSnapshot|unitCost|lotCode/);
    await expect(shop("order.get", { token: "x".repeat(43) })).rejects.toThrow(/過期|無效/);
    await expectReconciled();
  });

  it("前台商品資料不含成本、供應商、批次", async () => {
    await storeFixture({ finished: 3 });
    const p = await shop<{ product: Record<string, unknown> }>("product.get", { slug: "yirgacheffe" });
    expect(JSON.stringify(p)).not.toMatch(/unitCost|supplier|lotCode|standardCost|costSnapshot|"sku"/);
    expect((p.product.variants as Array<{ state: string }>)[0].state).toBe("IN_STOCK");
  });

  it("價格變動：送出時要求重新確認（PRICE_CHANGED）", async () => {
    const f = await storeFixture({ finished: 3 });
    const q = await quote([{ variantId: f.v100.id, qty: 1 }]);
    await db.collection(C.variants).doc(f.v100.id).update({ salePrice: "999" });
    await expect(shop("order.create", { lines: [{ variantId: f.v100.id, qty: 1 }], contact, pickup, agree: true, signature: q.signature, idempotencyKey: "same-key-0000000001" })).rejects.toMatchObject({ code: "PRICE_CHANGED" });
  });

  it("重複送出（同一 idempotencyKey）只建立一筆訂單", async () => {
    const f = await storeFixture({ finished: 3 });
    const q = await quote([{ variantId: f.v100.id, qty: 1 }]);
    const body = { lines: [{ variantId: f.v100.id, qty: 1 }], contact, pickup, agree: true, signature: q.signature, idempotencyKey: "dup-key-00000000001" };
    const [a, b] = await Promise.all([shop("order.create", body), shop("order.create", body)]);
    expect(a.orderNo).toBe(b.orderNo);
    expect(await docs(C.orders)).toHaveLength(1);
    expect(n((await lotOf(f.fgLotId!)).reserved)).toBe(1);
  });

  it("多人同時購買最後一份：只有一筆成功，不超賣", async () => {
    const f = await storeFixture({ finished: 1 });
    const q = await quote([{ variantId: f.v100.id, qty: 1 }]);
    const mk = (k: string) => shop("order.create", { lines: [{ variantId: f.v100.id, qty: 1 }], contact, pickup, agree: true, signature: q.signature, idempotencyKey: k });
    const rs = await Promise.allSettled([mk("race-a-000000000001"), mk("race-b-000000000001"), mk("race-c-000000000001")]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(rs.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason.code === "INSUFFICIENT_STOCK")).toBe(true);
    expect(n((await lotOf(f.fgLotId!)).reserved)).toBe(1);
    await expectReconciled();
  });

  it("接單後分裝：預留單一熟豆批次與包材；完成分裝不重複扣熟豆", async () => {
    const f = await storeFixture({ roastedG: 425 });
    // v200：接單後分裝，每包 200g → 單一批次 425g 最多 2 包
    await place([{ variantId: f.v200.id, qty: 2 }]);
    expect(n((await lotOf(f.roastedLotId)).reserved)).toBe(400);
    expect(n((await lotOf(f.bagLotId)).reserved)).toBe(2);
    await expect(place([{ variantId: f.v200.id, qty: 1 }])).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    const po = (await docs(C.productionOrders))[0];
    await op("production.complete", { id: po.id, actualQty: "2", lossG: "0" });
    expect(n((await lotOf(f.roastedLotId)).onHand)).toBe(25);
    expect(n((await lotOf(f.roastedLotId)).reserved)).toBe(0);
    expect(n((await lotOf(f.bagLotId)).onHand)).toBe(48);
    expect(n((await lotOf(f.bagLotId)).reserved)).toBe(0);
    const o = (await docs(C.orders))[0];
    expect(o.fulfillmentStatus).toBe("READY_TO_SHIP");
    // 出貨扣成品，不再扣熟豆
    await op("order.confirmPayment", { orderId: o.id });
    await op("order.ship", { orderId: o.id, carrier: "7-ELEVEN", trackingNo: "T123" });
    expect(n((await lotOf(f.roastedLotId)).onHand)).toBe(25);
    await expectReconciled();
  });

  it("不同烘焙批次的零碎重量不合併成一包（不混豆）", async () => {
    const f = await baseFixture();
    await op("store.product.save", { productId: f.product.id, status: "ACTIVE", slug: "mix", flavor: "", summary: "", images: [{ url: "https://example.test/a.jpg", alt: "" }], details: [], grindable: true, sortOrder: 0 });
    const g = await receiveGreen(f.coffee.id);
    await roast(g.id, f.roaster.id, 400, 300);
    await roast(g.id, f.roaster.id, 400, 300);
    // 兩批各 300g：200g 規格各批只能裝 1 包；一次買 2 包需要單一批次 400g → 拒絕
    await expect(place([{ variantId: f.v200.id, qty: 2 }])).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    await place([{ variantId: f.v200.id, qty: 1 }]);
    await place([{ variantId: f.v200.id, qty: 1 }]);
    await expect(place([{ variantId: f.v200.id, qty: 1 }])).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect((await docs(C.productionOrders)).map((p) => p.sourceLotId).sort()).toHaveLength(2);
    expect(new Set((await docs(C.productionOrders)).map((p) => p.sourceLotId)).size).toBe(2);
    await expectReconciled();
  });

  it("研磨方式不同的同一規格分開成兩行；原豆與研磨不合併", async () => {
    const f = await storeFixture({ finished: 5 });
    const q = await quote([{ variantId: f.v100.id, qty: 1 }, { variantId: f.v100.id, qty: 1, grind: "POUR_OVER" }, { variantId: f.v100.id, qty: 1, grind: "POUR_OVER" }]);
    expect(q.lines).toHaveLength(2);
    expect(q.lines.find((l: { grind: unknown }) => l.grind)?.qty).toBe(2);
    await place([{ variantId: f.v100.id, qty: 1 }, { variantId: f.v100.id, qty: 2, grind: "ESPRESSO" }]);
    const items = await docs(C.orderItems);
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.grind)?.grind).toMatchObject({ key: "ESPRESSO", label: "義式" });
  });

  it("下架的商品留在購物車：報價標示下架、無法送出", async () => {
    const f = await storeFixture({ finished: 3 });
    await op("store.product.save", { productId: f.product.id, status: "HIDDEN", slug: "yirgacheffe", flavor: "", summary: "", images: [], details: [], grindable: true, sortOrder: 0 });
    const q = await quote([{ variantId: f.v100.id, qty: 1 }]);
    expect(q.lines).toHaveLength(0);
    expect(q.issues[0].code).toBe("PRODUCT_UNAVAILABLE");
  });
});

describe("禮盒", () => {
  async function giftFixture() {
    const f = await storeFixture({ finished: 3 });
    const box = await op<{ id: string }>("material.save", { name: "禮盒", category: "BOX" });
    await op("inventory.receiveMaterial", { materialId: box.id, quantity: "10", unitCost: "30" });
    const gp = await op<{ id: string }>("product.save", { name: "選物禮盒", category: "GIFT_BOX", status: "ACTIVE" });
    const fixed = await op<{ id: string }>("variant.save", { productId: gp.id, name: "兩入禮盒", listPrice: "800", salePrice: "780", stockPolicy: "STOCK_ONLY", status: "ACTIVE", isBundle: true, components: [{ componentVariantId: f.v100.id, quantity: "2" }], materials: [{ materialId: box.id, quantityPerUnit: "1" }] });
    const custom = await op<{ id: string }>("variant.save", { productId: gp.id, name: "自選三入", listPrice: "0", salePrice: "1200", stockPolicy: "STOCK_ONLY", status: "ACTIVE", isBundle: true, components: [{ componentVariantId: f.v100.id, quantity: "1" }], materials: [{ materialId: box.id, quantityPerUnit: "1" }] });
    await op("store.variant.save", { variantId: custom.id, visible: true, sortOrder: 0, customBundle: { eligibleVariantIds: [f.v100.id, f.v200.id], min: 3, max: 3, allowRepeat: true, pricing: "FIXED", extra: "0" } });
    await op("store.product.save", { productId: gp.id, status: "ACTIVE", slug: "gift", flavor: "", summary: "", images: [{ url: "https://example.test/g.jpg", alt: "" }], details: [], grindable: false, sortOrder: 0 });
    return { ...f, fixed, custom, box };
  }

  it("固定禮盒與單品共用成品庫存，不超賣；禮盒包材一起預留", async () => {
    const f = await giftFixture();
    await place([{ variantId: f.fixed.id, qty: 1 }]); // 用掉 2 包成品 + 1 個禮盒
    expect(n((await lotOf(f.fgLotId!)).reserved)).toBe(2);
    await expect(place([{ variantId: f.v100.id, qty: 2 }])).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    await place([{ variantId: f.v100.id, qty: 1 }]);
    const allocs = await docs(C.allocations);
    expect(allocs.some((a) => String(a.variantId).startsWith("material:"))).toBe(true);
    expect((await docs(C.orderItems)).find((i) => i.isBundle)?.costSnapshot).not.toBeNull();
    await expectReconciled();
  });

  it("自選禮盒：檢查數量限制、保存選擇內容快照、展開成組件需求保留", async () => {
    const f = await giftFixture();
    const bad = await quote([{ variantId: f.custom.id, qty: 1, bundle: [{ variantId: f.v100.id, qty: 2 }] }]);
    expect(bad.issues[0].code).toBe("INVALID_BUNDLE");
    // 2 包現貨 100g + 1 包 200g（接單後分裝）
    await place([{ variantId: f.custom.id, qty: 1, bundle: [{ variantId: f.v100.id, qty: 2 }, { variantId: f.v200.id, qty: 1 }] }]);
    const it = (await docs(C.orderItems))[0];
    expect(it.customBundle).toBe(true);
    expect((it.bundleComponents as unknown[]).length).toBe(2);
    expect(n((await lotOf(f.fgLotId!)).reserved)).toBe(2);
    expect(n((await lotOf(f.roastedLotId)).reserved)).toBe(200);
    await expectReconciled();
  });
});

describe("預購", () => {
  async function preorderFixture(cap = 2) {
    const f = await storeFixture({ finished: 2 });
    await op("store.preorder.save", { variantId: f.v200.id, name: "新產季預購", startAt: null, endAt: null, cap, shipDate: "2027-01-15", status: "ACTIVE" });
    return { ...f, campaign: (await docs(C.preorders))[0] };
  }

  it("達到上限停止接單；配額與實體庫存分開；取消釋放", async () => {
    const f = await preorderFixture(2);
    const r = await place([{ variantId: f.v200.id, qty: 2 }]);
    expect((await docs(C.preorders))[0].reservedQty).toBe(2);
    expect(n((await lotOf(f.roastedLotId)).reserved)).toBe(0); // 不動用實體庫存
    await expect(place([{ variantId: f.v200.id, qty: 1 }])).rejects.toMatchObject({ code: "PREORDER_SOLD_OUT" });
    await shop("order.cancel", { token: r.token });
    expect((await docs(C.preorders))[0].reservedQty).toBe(0);
    await place([{ variantId: f.v200.id, qty: 1 }]);
  });

  it("現貨與預購同一訂單：預計出貨日取最晚、付款後配額轉為已確認、到貨後分配合併出貨", async () => {
    const f = await preorderFixture(5);
    const q = await quote([{ variantId: f.v100.id, qty: 1 }, { variantId: f.v200.id, qty: 1 }]);
    expect(q.estShipDate).toBe("2027-01-15");
    expect(q.hasPreorder).toBe(true);
    const r = await place([{ variantId: f.v100.id, qty: 1 }, { variantId: f.v200.id, qty: 1 }]);
    const o = (await docs(C.orders))[0];
    expect(o.fulfillmentStatus).toBe("AWAITING_PACKAGING");
    await op("order.confirmPayment", { orderId: o.id });
    expect((await docs(C.preorders))[0]).toMatchObject({ reservedQty: 0, confirmedQty: 1 });
    // 延期：保留原始承諾日、通知顧客
    await op("store.preorder.delay", { id: f.campaign.id, shipDate: "2027-02-01", note: "生豆到港延誤" });
    const after = (await docs(C.orders))[0];
    expect((after.store as Record<string, unknown>).estShipDate).toBe("2027-02-01");
    expect((after.store as Record<string, unknown>).originalEstShipDate).toBe("2027-01-15");
    // 到貨：分配（接單後分裝 200g）→ 完成分裝 → 可出貨
    await op("store.preorder.allocate", { orderId: o.id });
    const po = (await docs(C.productionOrders)).find((p) => p.orderId === o.id)!;
    await op("production.complete", { id: po.id, actualQty: "1" });
    expect((await docs(C.orders))[0].fulfillmentStatus).toBe("READY_TO_SHIP");
    const view = await shop<{ order: Record<string, any> }>("order.get", { token: r.token }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(view.order.originalEstShipDate).toBe("2027-01-15");
    await expectReconciled();
  });
});

describe("優惠", () => {
  async function promo(data: Record<string, unknown>) {
    await op("store.promotion.save", { id: null, active: true, startAt: null, endAt: null, value: null, appliesTo: "ALL", productIds: [], variantIds: [], minSpend: null, comboQty: null, usageLimit: null, perCustomerLimit: null, priority: 0, stackable: true, maxDiscount: null, code: null, ...data });
  }

  it("可疊加與不可疊加：決定性地選出折抵最多的組合；折扣分攤到明細", async () => {
    const f = await storeFixture({ finished: 5 });
    await promo({ name: "全館 9 折", type: "PERCENT", value: "10" });
    await promo({ name: "折 50", code: "SAVE50", type: "AMOUNT", value: "50" });
    await promo({ name: "獨享折 150", code: "BIG150", type: "AMOUNT", value: "150", stackable: false });
    // 840 → 9 折 84 + 折 50 = 134
    let q = await quote([{ variantId: f.v100.id, qty: 2 }], "SAVE50");
    expect(q.discount).toBe("134");
    expect(q.promotions.map((p: { name: string }) => p.name).sort()).toEqual(["全館 9 折", "折 50"].sort());
    // 獨享 150 > 自動 9 折 84 → 選 150
    q = await quote([{ variantId: f.v100.id, qty: 2 }], "BIG150");
    expect(q.discount).toBe("150");
    const r = await place([{ variantId: f.v100.id, qty: 2 }], { couponCode: "BIG150" });
    expect(r.orderNo).toBeTruthy();
    const items = await docs(C.orderItems);
    expect(items[0].discount).toBe("150.00");
    expect((await docs(C.redemptions))).toHaveLength(1);
  });

  it("免運門檻邊界：折扣後剛好達門檻免運，差 1 元收運費", async () => {
    const f = await storeFixture({ finished: 5 });
    await db.collection(C.settings).doc("store").set({ shipping: { fee: "60", freeThreshold: "840", freeBasis: "AFTER_ITEM_DISCOUNT", isDemo: true } });
    expect((await quote([{ variantId: f.v100.id, qty: 2 }])).shippingFee).toBe("0");
    // 自動優惠「折 1」會讓顧客失去免運 → 引擎選擇對顧客較划算的方案（不套用折 1、免運）
    await promo({ name: "折 1", type: "AMOUNT", value: "1" });
    const q1 = await quote([{ variantId: f.v100.id, qty: 2 }]);
    expect(q1).toMatchObject({ shippingFee: "0", discount: "0" });
    await db.collection(C.settings).doc("store").set({ shipping: { fee: "60", freeThreshold: "841", freeBasis: "AFTER_ITEM_DISCOUNT", isDemo: true } });
    const q = await quote([{ variantId: f.v100.id, qty: 2 }]);
    expect(q.shippingFee).toBe("60");
    expect(q.freeShippingRemaining).toBe("2");
  });

  it("折扣碼使用次數併發：上限 1 次只會成功一筆；取消後釋放", async () => {
    const f = await storeFixture({ finished: 5 });
    await promo({ name: "限量", code: "ONCE", type: "AMOUNT", value: "100", usageLimit: 1 });
    const q = await quote([{ variantId: f.v100.id, qty: 1 }], "ONCE");
    const mk = (k: string) => shop("order.create", { lines: [{ variantId: f.v100.id, qty: 1 }], couponCode: "ONCE", contact, pickup, agree: true, signature: q.signature, idempotencyKey: k });
    const rs = await Promise.allSettled([mk("promo-a-00000000001"), mk("promo-b-00000000001")]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await docs(C.promotions))[0].usedCount).toBe(1);
    const ok = rs.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ token: string }>;
    await shop("order.cancel", { token: ok.value.token });
    expect((await docs(C.promotions))[0].usedCount).toBe(0);
  });
});

describe("付款與逾期", () => {
  it("末五碼保留前導零；回報後待人工確認；確認付款冪等", async () => {
    const f = await storeFixture({ finished: 3 });
    const r = await place([{ variantId: f.v100.id, qty: 1 }]);
    await shop("order.reportPayment", { token: r.token, last5: "01234" });
    const rep = (await docs(C.paymentReports))[0];
    expect(rep.last5).toBe("01234");
    const o = (await docs(C.orders))[0];
    expect(o.paymentStatus).toBe("PENDING_CONFIRMATION");
    await expect(shop("order.cancel", { token: r.token })).rejects.toMatchObject({ code: "ORDER_STATE_CONFLICT" });
    await op("order.confirmPayment", { orderId: o.id });
    await op("order.confirmPayment", { orderId: o.id });
    expect((await docs(C.payments)).filter((p) => p.type === "PAYMENT")).toHaveLength(1);
    expect((await docs(C.paymentReports))[0].status).toBe("ACCEPTED");
    await processOutbox(db, provider); // 正式環境由寄件匣觸發器寄出
    expect(sent.some((m) => m.subject.includes("付款確認"))).toBe(true);
  });

  it("逾期：未回報的自動取消並釋放庫存；已回報的不取消、標記人工確認", async () => {
    const f = await storeFixture({ finished: 3 });
    const a = await place([{ variantId: f.v100.id, qty: 1 }]);
    const b = await place([{ variantId: f.v100.id, qty: 1 }]);
    await shop("order.reportPayment", { token: b.token, last5: "99999" });
    const later = new Date(Date.now() + 100 * 3600_000);
    const actor = { userId: null, name: "系統" };
    for (const o of await docs(C.orders)) await runTx(db, (t) => expireOne(t, o.id, later, actor));
    const oa = (await docs(C.orders)).find((o) => o.id === a.orderId)!;
    const ob = (await docs(C.orders)).find((o) => o.id === b.orderId)!;
    expect(oa).toMatchObject({ paymentStatus: "EXPIRED", fulfillmentStatus: "CANCELLED" });
    expect(ob.fulfillmentStatus).not.toBe("CANCELLED");
    expect((ob.store as Record<string, unknown>).needsReview).toBe(true);
    expect(n((await lotOf(f.fgLotId!)).reserved)).toBe(1);
    await expect(shop("order.reportPayment", { token: a.token, last5: "12345" })).rejects.toMatchObject({ code: "PAYMENT_EXPIRED" });
    await expectReconciled();
  });

  it("付款確認與逾期排程同時執行：狀態與庫存一致", async () => {
    const f = await storeFixture({ finished: 3 });
    await place([{ variantId: f.v100.id, qty: 1 }]);
    const o = (await docs(C.orders))[0];
    const later = new Date(Date.now() + 100 * 3600_000);
    await Promise.allSettled([op("order.confirmPayment", { orderId: o.id, force: true }), runTx(db, (t) => expireOne(t, o.id, later, { userId: null }))]);
    const after = (await docs(C.orders))[0];
    if (after.paymentStatus === "EXPIRED") expect(n((await lotOf(f.fgLotId!)).reserved)).toBe(0);
    else expect(after.paymentStatus).toBe("PAID");
    await expectReconciled();
  });

  it("付款異常：退回回報後顧客可重新回報；退款紀錄", async () => {
    const f = await storeFixture({ finished: 3 });
    const r = await place([{ variantId: f.v100.id, qty: 1 }]);
    await shop("order.reportPayment", { token: r.token, last5: "11111" });
    const o = (await docs(C.orders))[0];
    await op("store.payment.reject", { id: o.id, reason: "查無此筆匯款" });
    expect((await docs(C.orders))[0].paymentStatus).toBe("REJECTED");
    await shop("order.reportPayment", { token: r.token, last5: "22222" });
    await op("order.confirmPayment", { orderId: o.id });
    await op("store.payment.status", { id: o.id, to: "REFUND_PENDING", note: "顧客要求取消" });
    await op("order.refund", { orderId: o.id, amount: "480" });
    expect((await docs(C.orders))[0].paymentStatus).toBe("REFUNDED");
    expect((await docs(C.orderEvents)).length).toBeGreaterThan(4);
  });
});

describe("物流", () => {
  it("超商門市驗證、物流單號與狀態轉換", async () => {
    const f = await storeFixture({ finished: 3 });
    const q = await quote([{ variantId: f.v100.id, qty: 1 }]);
    await expect(shop("order.create", { lines: [{ variantId: f.v100.id, qty: 1 }], contact, pickup: { ...pickup, storeId: "12" }, agree: true, signature: q.signature, idempotencyKey: "pk-0000000000000001" })).rejects.toMatchObject({ code: "INVALID_PICKUP_STORE" });
    await place([{ variantId: f.v100.id, qty: 1 }], { pickup: { carrier: "FAMILY", storeId: "654321", storeName: "全家測試店" } });
    const o = (await docs(C.orders))[0];
    expect((o.store as Record<string, any>).pickup).toMatchObject({ carrier: "FAMILY", carrierLabel: "全家", storeId: "654321" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    await op("order.confirmPayment", { orderId: o.id });
    await op("order.ship", { orderId: o.id, carrier: "全家", trackingNo: "F0001" });
    await expect(op("store.shipment", { id: o.id, status: "PICKED_UP", trackingNo: null, note: null })).rejects.toThrow(/不能改成/);
    await op("store.shipment", { id: o.id, status: "ARRIVED", trackingNo: null, note: null });
    await op("store.shipment", { id: o.id, status: "PICKED_UP", trackingNo: null, note: null });
    expect((await docs(C.orders))[0].fulfillmentStatus).toBe("PICKED_UP");
    await processOutbox(db, provider);
    const box = await docs(C.outbox);
    for (const t of ["ORDER_SHIPPED", "ARRIVED", "PAYMENT_CONFIRMED"]) expect(box.find((m) => m.template === t)?.status).toBe("SENT");
  });
});

describe("訪客查詢與會員權限", () => {
  it("Email 驗證碼：錯誤次數限制、正確後取得連結；不洩漏訂單是否存在", async () => {
    const f = await storeFixture({ finished: 3 });
    const r = await place([{ variantId: f.v100.id, qty: 1 }]);
    const wrong = await shop<{ message: string }>("lookup.request", { orderNo: "SO-00000000-999", email: "x@example.test" });
    const right = await shop<{ message: string }>("lookup.request", { orderNo: r.orderNo, email: contact.email });
    expect(wrong.message).toBe(right.message);
    const mail = sent.find((m) => m.subject.includes("驗證碼"))!;
    const code = /驗證碼：(\d{6})/.exec(mail.text)![1];
    const bad = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await expect(shop("lookup.verify", { orderNo: r.orderNo, email: contact.email, code: bad })).rejects.toMatchObject({ code: "CODE_INVALID" });
    await expect(shop("lookup.verify", { orderNo: r.orderNo, email: contact.email, code })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("驗證碼正確取得新連結；撤銷後連結失效", async () => {
    const f = await storeFixture({ finished: 3 });
    const r = await place([{ variantId: f.v100.id, qty: 1 }]);
    await shop("lookup.request", { orderNo: r.orderNo, email: contact.email.toUpperCase() });
    const code = /驗證碼：(\d{6})/.exec(sent.find((m) => m.subject.includes("驗證碼"))!.text)![1];
    const v = await shop<{ token: string }>("lookup.verify", { orderNo: r.orderNo, email: contact.email, code });
    expect((await shop<{ order: { orderNo: string } }>("order.get", { token: v.token })).order.orderNo).toBe(r.orderNo);
    await op("store.access.revoke", { id: r.orderId });
    await expect(shop("order.get", { token: v.token })).rejects.toMatchObject({ code: "UNAUTHORIZED_ORDER_ACCESS" });
    await expect(shop("order.get", { token: r.token })).rejects.toMatchObject({ code: "UNAUTHORIZED_ORDER_ACCESS" });
  });

  it("會員只能看自己的訂單；未登入不能用會員 API", async () => {
    const f = await storeFixture({ finished: 3 });
    const alice: Who = { uid: "alice", email: "a@example.test", emailVerified: true };
    const bob: Who = { uid: "bob", email: "b@example.test", emailVerified: true };
    const r = await place([{ variantId: f.v100.id, qty: 1 }], { saveProfile: true }, alice);
    expect((await shop<{ orders: unknown[] }>("account.orders", {}, alice)).orders).toHaveLength(1);
    expect((await shop<{ orders: unknown[] }>("account.orders", {}, bob)).orders).toHaveLength(0);
    await expect(shop("order.get", { orderId: r.orderId }, bob)).rejects.toMatchObject({ code: "UNAUTHORIZED_ORDER_ACCESS" });
    expect((await shop<{ order: { orderNo: string } }>("order.get", { orderId: r.orderId }, alice)).order.orderNo).toBe(r.orderNo);
    await expect(shop("account.me", {})).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
    const me = await shop<{ profile: { savedStores: unknown[] } }>("account.me", {}, alice);
    expect(me.profile.savedStores).toHaveLength(1);
  });

  it("登入後合併購物車：同一行取較大數量，不同研磨分開", async () => {
    const f = await storeFixture({ finished: 3 });
    const u: Who = { uid: "carol" };
    await shop("cart.save", { lines: [{ variantId: f.v100.id, qty: 2 }] }, u);
    const r = await shop<{ lines: Array<{ qty: number; grind?: string }> }>("cart.save", { lines: [{ variantId: f.v100.id, qty: 1 }, { variantId: f.v100.id, qty: 1, grind: "MOKA" }], merge: true }, u);
    expect(r.lines).toHaveLength(2);
    expect(r.lines.find((l) => !l.grind)?.qty).toBe(2);
  });

  it("顧客不能呼叫後台操作：商城 API 沒有後台操作", async () => {
    await expect(shop("order.confirmPayment", { id: "x" })).rejects.toThrow(/未知的操作/);
    await expect(shop("store.settings.save", {})).rejects.toThrow(/未知的操作/);
  });
});
