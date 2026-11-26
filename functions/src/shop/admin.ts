/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 商城後台操作（併入管理員 API `api` 的操作表，只有管理員能呼叫）。
 */
import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { D } from "../../../src/lib/decimal";
import { DomainError } from "../../../src/lib/errors";
import { runTx, nowIso, type Tx } from "../tx";
import { C, type Actor } from "../types";
import { audit } from "../domain/core";
import { confirmOr } from "../soft";
import { dbReader, loadModel } from "./catalog";
import { homeView, pageView, safeLink } from "./content";
import { allocatePreorder, delayPreorder, rejectPayment, revokeAccess, setPaymentStatus, updateShipment } from "./orders";
import { storeSettings, storeSettingsDb } from "./settings";
import { defaultProvider, processOutbox } from "./outbox";
import { orderStatusOf } from "./view";

interface Ctx {
  db: Firestore;
  actor: Actor;
}
const op = <S extends z.ZodTypeAny>(schema: S, run: (input: z.infer<S>, ctx: Ctx) => Promise<unknown>) => ({ schema, run });
const tx = <T>(ctx: Ctx, fn: (t: Tx) => Promise<T>) => runTx(ctx.db, fn);
const s = (max = 2000) => z.preprocess((v) => (typeof v === "string" ? v.trim() : (v ?? "")), z.string().max(max));
const ns = (max = 2000) => z.preprocess((v) => (typeof v === "string" ? v.trim() || null : (v ?? null)), z.string().max(max).nullable());
const int = (min = 0, max = 100000) => z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().min(min).max(max));
const money = z.preprocess((v) => (typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : v), z.string().regex(/^\d{1,7}$/, "請輸入整數金額"));
const optMoney = z.preprocess((v) => (v === "" || v == null ? null : String(v).trim()), z.string().regex(/^\d{1,7}$/, "請輸入整數金額").nullable());
const iso = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().max(40).nullable());
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式 YYYY-MM-DD");
const slugRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const imgUrl = z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(1000).refine((u) => !u || /^https:\/\//.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u) || u.startsWith("/"), "圖片網址需為 https"));

/** 台北時間 YYYY-MM-DDTHH:mm → ISO */
const twToIso = (v: string | null) => (v ? (v.length === 16 ? new Date(`${v}:00+08:00`).toISOString() : new Date(v).toISOString()) : null);

export const STORE_ADMIN_OPS = {
  "store.settings.save": op(
    z.object({
      open: z.boolean(),
      maintenance: z.boolean(),
      maintenanceMessage: s(300),
      bank: z.object({ bankName: s(60), bankCode: s(10), branch: s(60), accountNo: s(30), accountName: s(60), isDemo: z.boolean() }),
      paymentDeadlineHours: int(1, 720),
      paymentReminderHours: int(0, 240),
      shipping: z.object({ fee: money, freeThreshold: optMoney, freeBasis: z.enum(["AFTER_ITEM_DISCOUNT", "SUBTOTAL"]), isDemo: z.boolean() }),
      pickupChannels: z.array(z.object({ key: z.enum(["SEVEN", "FAMILY"]), label: s(20), enabled: z.boolean() })).length(2),
      prepDays: int(0, 60),
      nonShipWeekdays: z.array(int(0, 6)).max(7),
      nonShipDates: z.array(ymd).max(200),
      grindOptions: z.array(z.object({ key: z.string().regex(/^[A-Z_]{2,30}$/), label: s(30), enabled: z.boolean() })).max(20),
      minShelfDaysAtShip: int(0, 365),
      maxQtyPerLine: int(1, 99),
      service: z.object({ email: s(200), phone: s(30), lineUrl: s(300), hours: s(100) }),
      social: z.object({ instagram: s(300), facebook: s(300), line: s(300) }),
      business: z.object({ name: s(100), taxId: s(20), address: s(200), foodRegNo: s(60), phone: s(30) }),
    }),
    (i, ctx) =>
      tx(ctx, async (t) => {
        if (!i.bank.isDemo && (!i.bank.accountNo || !i.bank.accountName || !i.bank.bankCode)) throw new DomainError("正式收款帳戶需填寫銀行代碼、帳號與戶名");
        const prev = await storeSettings(t);
        t.set(C.settings, "store", { ...prev, ...i, updatedAt: nowIso() });
        audit(t, ctx.actor, "store.settings", "StoreSettings", "store", "更新商城設定", { bankChanged: JSON.stringify(prev.bank) !== JSON.stringify(i.bank), shipping: i.shipping, open: i.open, maintenance: i.maintenance });
        return { message: "已儲存商城設定" };
      }),
  ),

  "store.product.save": op(
    z.object({
      productId: z.string().min(1).max(200),
      status: z.enum(["DRAFT", "ACTIVE", "HIDDEN", "COMING_SOON"]),
      slug: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.string().max(80).refine((x) => !x || slugRe.test(x), "網址代稱只能用小寫英文、數字與 -")),
      flavor: s(60),
      summary: s(300),
      images: z.array(z.object({ url: imgUrl, alt: s(100) })).max(10),
      details: z.array(z.object({ title: s(30), body: s(2000) })).max(10),
      grindable: z.boolean(),
      sortOrder: int(-10000, 10000).default(0),
    }),
    (i, ctx) =>
      tx(ctx, async (t) => {
        const p = await t.must(C.products, i.productId, "商品");
        const slug = i.slug || String(p.code ?? p.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const prev = (p.store as { slug?: string } | undefined)?.slug;
        if (slug !== prev) {
          await t.claimUnique("storeSlug", slug, `網址代稱「${slug}」已被其他商品使用`);
          if (prev) await t.releaseUnique("storeSlug", prev);
        }
        if (i.status === "ACTIVE") {
          const vs = (await t.query(C.variants, [["productId", "==", p.id]])).filter((v) => v.status === "ACTIVE");
          if (!vs.length) confirmOr("這個商品還沒有上架中的規格，前台不會顯示。仍要上架嗎？");
          if (!i.images.filter((x) => x.url).length) confirmOr("這個商品還沒有圖片，前台會顯示空白圖。仍要上架嗎？");
        }
        await t.update(C.products, p.id, { store: { status: i.status, slug, flavor: i.flavor, summary: i.summary, images: i.images.filter((x) => x.url), details: i.details.filter((d) => d.title && d.body), grindable: i.grindable, sortOrder: i.sortOrder }, updatedAt: nowIso() });
        audit(t, ctx.actor, "store.product", "Product", p.id, `商城商品設定：${p.name}（${i.status}）`);
        return { id: p.id, message: "已儲存商城設定" };
      }),
  ),

  "store.variant.save": op(
    z.object({
      variantId: z.string().min(1).max(200),
      visible: z.boolean(),
      sortOrder: int(-10000, 10000).default(0),
      customBundle: z.object({ eligibleVariantIds: z.array(z.string().max(200)).min(1, "請選擇可挑選的商品").max(60), min: int(1, 50), max: int(1, 50), allowRepeat: z.boolean(), pricing: z.enum(["FIXED", "SUM_PLUS"]), extra: money.default("0") }).nullable().optional(),
    }),
    (i, ctx) =>
      tx(ctx, async (t) => {
        const v = await t.must(C.variants, i.variantId, "規格");
        if (i.customBundle) {
          if (!v.isBundle) throw new DomainError("自選禮盒需先在規格設定勾選「套組／禮盒」");
          if (i.customBundle.min > i.customBundle.max) throw new DomainError("最少數量不可大於最多數量");
          for (const id of i.customBundle.eligibleVariantIds) {
            const cv = await t.must(C.variants, id, "可選商品");
            if (cv.isBundle) throw new DomainError("自選禮盒的可選商品不可以是另一個禮盒");
          }
        }
        await t.update(C.variants, v.id, { store: { visible: i.visible, sortOrder: i.sortOrder, customBundle: i.customBundle ?? null }, updatedAt: nowIso() });
        audit(t, ctx.actor, "store.variant", "ProductVariant", v.id, `商城規格設定：${v.sku}`);
        return { id: v.id, message: "已儲存" };
      }),
  ),

  "store.preorder.save": op(
    z.object({ id: ns(200), variantId: z.string().min(1).max(200), name: s(60), startAt: iso, endAt: iso, cap: int(1, 100000), shipDate: ymd, status: z.enum(["ACTIVE", "PAUSED", "CLOSED"]) }),
    (i, ctx) =>
      tx(ctx, async (t) => {
        const v = await t.must(C.variants, i.variantId, "規格");
        const data = { variantId: v.id, variantName: `${v.productName}｜${v.name}`, name: i.name || `${v.productName} 預購`, startAt: twToIso(i.startAt), endAt: twToIso(i.endAt), cap: i.cap, shipDate: i.shipDate, status: i.status, updatedAt: nowIso() };
        if (data.startAt && data.endAt && data.endAt < data.startAt) throw new DomainError("結束時間早於開始時間");
        if (i.id) {
          const c = await t.must(C.preorders, i.id, "預購活動");
          if (i.cap < Number(c.reservedQty ?? 0) + Number(c.confirmedQty ?? 0)) confirmOr(`上限 ${i.cap} 小於已接單數量 ${Number(c.reservedQty ?? 0) + Number(c.confirmedQty ?? 0)}，之後不會再接新單。仍要儲存嗎？`);
          if (c.shipDate !== i.shipDate) throw new DomainError("要更改預計出貨日請用「延期」，系統會通知已下單的顧客");
          await t.update(C.preorders, c.id, data);
        } else {
          if (i.status === "ACTIVE" && (await t.query(C.preorders, [["variantId", "==", v.id], ["status", "==", "ACTIVE"]])).length) throw new DomainError("這個規格已有進行中的預購活動");
          t.create(C.preorders, { ...data, reservedQty: 0, confirmedQty: 0, originalShipDate: i.shipDate, createdAt: nowIso() });
        }
        audit(t, ctx.actor, "store.preorder", "PreorderCampaign", i.id ?? null, `預購活動 ${data.name}：上限 ${i.cap}，出貨 ${i.shipDate}`);
        return { message: "已儲存預購活動" };
      }),
  ),
  "store.preorder.delay": op(z.object({ id: z.string().min(1).max(200), shipDate: ymd, note: ns(300) }), async (i, ctx) => {
    const n = await tx(ctx, (t) => delayPreorder(t, i.id, i.shipDate, i.note, ctx.actor));
    await processOutbox(ctx.db, await defaultProvider(ctx.db), {}).catch(() => 0);
    return { message: `已更新出貨日，並通知 ${n} 筆訂單的顧客` };
  }),
  "store.preorder.allocate": op(z.object({ orderId: z.string().min(1).max(200) }), async (i, ctx) => {
    const n = await tx(ctx, (t) => allocatePreorder(t, i.orderId, ctx.actor));
    return { message: `已分配 ${n} 項預購商品` };
  }),

  "store.promotion.save": op(
    z.object({
      id: ns(200),
      name: s(60).refine((x) => !!x, "請填寫名稱"),
      code: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() || null : null), z.string().regex(/^[A-Z0-9_-]{3,30}$/, "折扣碼只能用英數字，3–30 字").nullable()),
      active: z.boolean(),
      startAt: iso,
      endAt: iso,
      type: z.enum(["AMOUNT", "PERCENT", "FREE_SHIPPING", "COMBO"]),
      value: optMoney,
      appliesTo: z.enum(["ALL", "PRODUCTS"]),
      productIds: z.array(z.string().max(200)).max(200).default([]),
      variantIds: z.array(z.string().max(200)).max(200).default([]),
      minSpend: optMoney,
      comboQty: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(2).max(20).nullable()),
      usageLimit: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(1).nullable()),
      perCustomerLimit: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(1).nullable()),
      priority: int(-1000, 1000).default(0),
      stackable: z.boolean(),
      maxDiscount: optMoney,
    }),
    (i, ctx) =>
      tx(ctx, async (t) => {
        if (i.type === "PERCENT" && (!i.value || Number(i.value) <= 0 || Number(i.value) >= 100)) throw new DomainError("百分比折扣請填 1–99");
        if (["AMOUNT", "COMBO"].includes(i.type) && (!i.value || Number(i.value) <= 0)) throw new DomainError("請填寫折扣金額");
        if (i.type === "COMBO" && (i.appliesTo !== "PRODUCTS" || !i.comboQty)) throw new DomainError("組合優惠需指定商品與組合件數");
        if (i.appliesTo === "PRODUCTS" && !i.productIds.length && !i.variantIds.length) throw new DomainError("請選擇適用商品");
        const { id: _id, ...rest } = i;
        void _id;
        const data = { ...rest, startAt: twToIso(i.startAt), endAt: twToIso(i.endAt), updatedAt: nowIso() };
        const prev = i.id ? await t.must(C.promotions, i.id, "優惠") : null;
        if (i.code && i.code !== prev?.code) await t.claimUnique("promoCode", i.code, `折扣碼 ${i.code} 已存在`);
        if (prev?.code && prev.code !== i.code) await t.releaseUnique("promoCode", String(prev.code));
        if (prev) await t.update(C.promotions, prev.id, data);
        else t.create(C.promotions, { ...data, usedCount: 0, createdAt: nowIso() });
        audit(t, ctx.actor, "store.promotion", "Promotion", i.id ?? null, `優惠活動 ${i.name}${i.code ? `（${i.code}）` : ""}`);
        return { message: "已儲存優惠" };
      }),
  ),

  "store.content.save": op(
    z.object({
      id: ns(200),
      type: z.enum(["HERO", "FEATURED", "CATEGORIES", "EVENT", "PAGE", "FOOTER", "SEO"]),
      key: ns(40),
      order: int(-1000, 1000).default(0),
      enabled: z.boolean(),
      draft: z.object({ title: ns(80), text: ns(300), body: ns(20000), imageDesktop: z.preprocess((v) => v || null, imgUrl.nullable()), imageMobile: z.preprocess((v) => v || null, imgUrl.nullable()), imageAlt: ns(100), link: ns(500), linkLabel: ns(20), productIds: z.array(z.string().max(200)).max(24).default([]), startAt: iso, endAt: iso }),
    }),
    (i, ctx) =>
      tx(ctx, async (t) => {
        if (i.draft.link && !safeLink(i.draft.link)) throw new DomainError("連結需為 /shop/ 開頭的站內路徑或 https 網址");
        const draft = { ...i.draft, startAt: twToIso(i.draft.startAt), endAt: twToIso(i.draft.endAt) };
        const data = { type: i.type, key: i.type === "PAGE" ? i.key : null, order: i.order, enabled: i.enabled, draft, updatedAt: nowIso() };
        if (i.id) await t.update(C.content, i.id, data);
        else t.create(C.content, { ...data, published: null, publishedAt: null, createdAt: nowIso() });
        audit(t, ctx.actor, "store.content.save", "ContentSection", i.id ?? null, `編輯內容區塊（草稿）${i.type}`);
        return { message: "已儲存草稿" };
      }),
  ),
  "store.content.publish": op(z.object({ id: z.string().min(1).max(200), unpublish: z.boolean().optional() }), (i, ctx) =>
    tx(ctx, async (t) => {
      const d = await t.must(C.content, i.id, "內容區塊");
      await t.update(C.content, d.id, i.unpublish ? { published: null, publishedAt: null } : { published: d.draft, publishedAt: nowIso() });
      audit(t, ctx.actor, "store.content.publish", "ContentSection", d.id, i.unpublish ? "取消發布" : "發布內容");
      return { message: i.unpublish ? "已取消發布" : "已發布" };
    }),
  ),
  "store.content.delete": op(z.object({ id: z.string().min(1).max(200) }), (i, ctx) =>
    tx(ctx, async (t) => {
      await t.must(C.content, i.id, "內容區塊");
      await t.delete(C.content, i.id);
      audit(t, ctx.actor, "store.content.delete", "ContentSection", i.id, "刪除內容區塊");
      return { message: "已刪除" };
    }),
  ),
  /** 預覽：用草稿內容組出首頁或靜態頁（只有管理員能看） */
  "store.content.preview": op(z.object({ page: ns(40) }), async (i, ctx) => {
    const st = await storeSettingsDb(ctx.db);
    const m = await loadModel(dbReader(ctx.db), st);
    if (i.page) return { page: await pageView(dbReader(ctx.db), i.page, { draft: true }) };
    return await homeView(dbReader(ctx.db), m, { draft: true });
  }),

  "store.payment.reject": op(z.object({ id: z.string().min(1).max(200), reason: s(200).refine((x) => !!x, "請填寫原因") }), async (i, ctx) => {
    await tx(ctx, (t) => rejectPayment(t, i.id, i.reason, ctx.actor));
    await processOutbox(ctx.db, await defaultProvider(ctx.db), {}).catch(() => 0);
    return { message: "已通知顧客重新確認付款" };
  }),
  "store.payment.status": op(z.object({ id: z.string().min(1).max(200), to: z.enum(["UNDER_REVIEW", "REFUND_PENDING"]), note: ns(200) }), async (i, ctx) => {
    await tx(ctx, (t) => setPaymentStatus(t, i.id, i.to, i.note, ctx.actor));
    return { message: "已更新付款狀態" };
  }),
  "store.shipment": op(z.object({ id: z.string().min(1).max(200), status: z.enum(["SHIPPED", "ARRIVED", "PICKED_UP", "LOGISTICS_ISSUE", "RETURNED_UNCLAIMED"]), trackingNo: ns(60), note: ns(200) }), async (i, ctx) => {
    await tx(ctx, (t) => updateShipment(t, i.id, i, ctx.actor));
    await processOutbox(ctx.db, await defaultProvider(ctx.db), {}).catch(() => 0);
    return { message: "已更新物流狀態" };
  }),
  "store.access.revoke": op(z.object({ id: z.string().min(1).max(200) }), async (i, ctx) => ({ message: `已撤銷 ${await tx(ctx, (t) => revokeAccess(t, i.id, ctx.actor))} 個訂單連結` })),
  "store.outbox.retry": op(z.object({ id: ns(200) }), async (i, ctx) => {
    if (i.id) await ctx.db.collection(C.outbox).doc(i.id).update({ status: "RETRY", nextAttemptAt: nowIso() });
    const n = await processOutbox(ctx.db, await defaultProvider(ctx.db), i.id ? { ids: [i.id] } : {});
    return { message: `已寄出 ${n} 封通知` };
  }),

  /** 電商報表：訂單金額、已付款、已完成收入、退款、折扣、運費、物流成本、商品成本、毛利、貢獻利益 */
  "store.report": op(z.object({ from: ymd, to: ymd }), async (i, ctx) => {
    const start = new Date(`${i.from}T00:00:00+08:00`).toISOString();
    const end = new Date(new Date(`${i.to}T00:00:00+08:00`).getTime() + 86400_000).toISOString();
    const orders = (await ctx.db.collection(C.orders).where("channel", "==", "STORE").get()).docs.map((d) => ({ ...d.data(), id: d.id }) as Record<string, any> & { id: string }).filter((o) => String(o.orderedAt) >= start && String(o.orderedAt) < end);
    let ordered = D(0), paid = D(0), completed = D(0), refunds = D(0), merch = D(0), discount = D(0), shippingIn = D(0), logistics = D(0), fees = D(0), cogs = D(0), cogsEst = 0;
    const counts: Record<string, number> = {};
    for (const o of orders) {
      const st = orderStatusOf(o as never);
      counts[st] = (counts[st] ?? 0) + 1;
      if (o.fulfillmentStatus !== "CANCELLED") ordered = ordered.add(o.total as string);
      const pays = (await ctx.db.collection(C.payments).where("orderId", "==", o.id).get()).docs.map((d) => d.data() as Record<string, string>);
      const inAmt = pays.filter((p) => p.type === "PAYMENT").reduce((t, p) => t.add(p.amount), D(0));
      const outAmt = pays.filter((p) => p.type === "REFUND").reduce((t, p) => t.add(p.amount), D(0));
      paid = paid.add(inAmt);
      refunds = refunds.add(outAmt);
      // 已實現：已付款且已出貨／完成的訂單（扣除退款，只扣一次）
      const realized = inAmt.gt(0) && ["SHIPPED", "ARRIVED", "PICKED_UP", "COMPLETED"].includes(o.fulfillmentStatus as string);
      if (!realized) continue;
      completed = completed.add(inAmt).sub(outAmt);
      merch = merch.add(o.subtotal as string);
      discount = discount.add(o.discountTotal as string);
      shippingIn = shippingIn.add(o.shippingFee as string);
      for (const c of (await ctx.db.collection(C.costs).where("orderId", "==", o.id).get()).docs.map((d) => d.data() as Record<string, string>)) {
        if (c.category === "SHIPPING") logistics = logistics.add(c.amount);
        else fees = fees.add(c.amount);
      }
      for (const it of (await ctx.db.collection(C.orderItems).where("orderId", "==", o.id).get()).docs.map((d) => d.data() as Record<string, string | null>)) {
        if (it.costSnapshot != null) cogs = cogs.add(it.costSnapshot);
        else cogsEst++;
      }
    }
    const refundShareOfMerch = refunds; // 退款以金額扣一次，不再從折扣重複扣除
    const grossProfit = merch.sub(refundShareOfMerch).sub(cogs);
    const contribution = grossProfit.add(shippingIn).sub(logistics).sub(fees);
    const f = (d: ReturnType<typeof D>) => d.toDecimalPlaces(0).toFixed(0);
    return { range: i, counts, orderCount: orders.length, ordered: f(ordered), paid: f(paid), completedRevenue: f(completed), refunds: f(refunds), merchandiseNet: f(merch), discount: f(discount), shippingCollected: f(shippingIn), logisticsCost: f(logistics), directFees: f(fees), cogs: f(cogs), itemsWithoutCost: cogsEst, grossProfit: f(grossProfit), contribution: f(contribution) };
  }),
};
