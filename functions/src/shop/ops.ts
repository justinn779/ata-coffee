/**
 * 商城 API 操作表（Callable Function `shop`）。
 *  - public：任何人（含未登入）
 *  - customer：需要登入的顧客（Google／LINE）
 * 與管理員 API（`api`）完全分開；這裡不會輸出成本、供應商、批次或其他顧客的資料。
 */
import type { Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { z } from "zod";
import { DomainError } from "../../../src/lib/errors";
import { runTx, nowIso } from "../tx";
import { C, type Actor } from "../types";
import { ConfirmError } from "../soft";
import { dbReader, listProducts, loadModel, publicProduct } from "./catalog";
import { buildQuote, lineKey, publicQuote } from "./pricing";
import { storeSettingsDb, type StoreSettings } from "./settings";
import { authorizeOrder, createStoreOrder, customerCancel, reportPayment, requestCode, verifyCode, sha } from "./orders";
import { publicOrder } from "./view";
import { homeView, pageView } from "./content";
import { defaultProvider, processOutbox, type NotificationProvider } from "./outbox";
import { ShopError } from "./errors";
import { dispatch } from "../notify/notify";
import { lineLinkStart } from "./line";

export interface ShopCtx {
  db: Firestore;
  who: { uid: string | null; email?: string | null; emailVerified?: boolean; name?: string | null };
  ip: string | null;
  /** 測試可注入通知管道與時間 */
  provider?: NotificationProvider | null;
  now?: Date;
  /** 模擬器／測試環境才允許的開發用登入 */
  allowMock?: boolean;
}

interface Op<S extends z.ZodTypeAny> {
  schema: S;
  auth: "public" | "customer";
  /** 每個 IP 每分鐘上限 */
  limit: number;
  run: (i: z.infer<S>, ctx: ShopCtx) => Promise<unknown>;
}
const op = <S extends z.ZodTypeAny>(auth: Op<S>["auth"], limit: number, schema: S, run: Op<S>["run"]): Op<S> => ({ schema, auth, limit, run });

const lineSchema = z.object({
  variantId: z.string().min(1).max(200),
  qty: z.number().int().min(1).max(99),
  grind: z.string().max(40).nullable().optional(),
  bundle: z.array(z.object({ variantId: z.string().min(1).max(200), qty: z.number().int().min(1).max(99) })).max(30).nullable().optional(),
});
const lines = z.array(lineSchema).max(50);
const orderRef = { token: z.string().max(100).nullable().optional(), orderId: z.string().max(200).nullable().optional() };
const actorOf = (ctx: ShopCtx): Actor => ({ userId: ctx.who.uid, name: ctx.who.uid ? `顧客 ${ctx.who.email ?? ctx.who.uid}` : "訪客", ip: ctx.ip });

function publicSettings(s: StoreSettings) {
  return {
    open: s.open && !s.maintenance,
    maintenance: s.maintenance,
    maintenanceMessage: s.maintenanceMessage,
    pickupChannels: s.pickupChannels.filter((c) => c.enabled).map((c) => ({ key: c.key, label: c.label })),
    grindOptions: s.grindOptions.filter((g) => g.enabled).map((g) => ({ key: g.key, label: g.label })),
    shippingFee: s.shipping.fee,
    freeThreshold: s.shipping.freeThreshold,
    paymentDeadlineHours: s.paymentDeadlineHours,
    service: s.service,
    social: s.social,
    business: s.business,
    demo: { bank: s.bank.isDemo, shipping: s.shipping.isDemo },
  };
}

async function model(ctx: ShopCtx) {
  const s = await storeSettingsDb(ctx.db);
  return { s, m: await loadModel(dbReader(ctx.db), s, { now: ctx.now }) };
}

/** 寄出這次操作產生的通知（盡力而為，失敗留在寄件匣由排程重試） */
async function flush(ctx: ShopCtx, prefix: string) {
  try {
    const ids = (await ctx.db.collection(C.outbox).where("status", "==", "PENDING").get()).docs.map((d) => d.id).filter((id) => id.startsWith(prefix));
    if (ids.length) await processOutbox(ctx.db, ctx.provider !== undefined ? ctx.provider : await defaultProvider(ctx.db), { ids });
  } catch (e) {
    console.warn("outbox flush", e);
  }
}

export const SHOP_OPS = {
  "store.boot": op("public", 120, z.object({}), async (_i, ctx) => ({ settings: publicSettings(await storeSettingsDb(ctx.db)) })),

  home: op("public", 120, z.object({}), async (_i, ctx) => {
    const { s, m } = await model(ctx);
    return { settings: publicSettings(s), ...(await homeView(dbReader(ctx.db), m)) };
  }),

  "products.list": op("public", 120, z.object({ category: z.enum(["beans", "drip", "gift", "other"]).nullable().optional() }), async (i, ctx) => {
    const { m } = await model(ctx);
    return { products: listProducts(m).filter((p) => !i.category || p.category === i.category) };
  }),

  "product.get": op("public", 120, z.object({ slug: z.string().min(1).max(200) }), async (i, ctx) => {
    const { s, m } = await model(ctx);
    const p = [...m.products.values()].find((x) => ((x.store as { slug?: string })?.slug || x.id) === i.slug);
    if (!p) throw new ShopError("PRODUCT_UNAVAILABLE", "找不到這個商品");
    return { product: publicProduct(m, p, { detail: true }), grindOptions: s.grindOptions.filter((g) => g.enabled).map((g) => ({ key: g.key, label: g.label })) };
  }),

  "page.get": op("public", 120, z.object({ key: z.enum(["story", "guide", "privacy", "terms", "contact", "returns"]) }), async (i, ctx) => ({ page: await pageView(dbReader(ctx.db), i.key), settings: publicSettings(await storeSettingsDb(ctx.db)) })),

  "cart.quote": op("public", 120, z.object({ lines, couponCode: z.string().max(40).nullable().optional(), email: z.string().max(200).nullable().optional() }), async (i, ctx) => {
    const { m } = await model(ctx);
    const key = ctx.who.uid ? `uid:${ctx.who.uid}` : i.email ? `email:${i.email.trim().toLowerCase()}` : null;
    const q = await buildQuote(dbReader(ctx.db), m, { lines: i.lines, couponCode: i.couponCode, customerKey: key });
    // 結帳頁需要知道每一行目前最多能買幾件（不足時提示）
    const stock: Record<string, number> = {};
    for (const l of q.lines) {
      const pv = publicProduct(m, l.product).variants.find((v) => v.id === l.variant.id);
      stock[l.key] = pv?.maxQty ?? 0;
    }
    return { quote: publicQuote(q), stock };
  }),

  "order.create": op(
    "public",
    10,
    z.object({
      lines: lines.min(1, "購物車是空的"),
      couponCode: z.string().max(40).nullable().optional(),
      contact: z.object({ name: z.string().trim().min(1, "請填寫收件人姓名").max(40, "姓名過長"), phone: z.string().trim().regex(/^09\d{8}$/, "手機號碼格式：09 開頭共 10 碼"), email: z.string().trim().email("Email 格式不正確").max(200) }),
      pickup: z.object({ carrier: z.enum(["SEVEN", "FAMILY"]), storeId: z.string().max(10), storeName: z.string().max(40), storeAddress: z.string().max(200).nullable().optional() }),
      note: z.string().max(300, "備註最多 300 字").nullable().optional(),
      agree: z.literal(true, { error: "請先閱讀並同意購物須知與隱私權政策" }),
      signature: z.string().min(1).max(64),
      idempotencyKey: z.string().min(16).max(100),
      saveProfile: z.boolean().optional(),
    }),
    async (i, ctx) => {
      const r = await runTx(ctx.db, (t) => createStoreOrder(t, i, ctx.who, actorOf(ctx)));
      if (!r.duplicate) {
        await flush(ctx, `order-created-${r.order.id}`);
        try {
          await dispatch({ db: ctx.db }, "newOrder", { title: `🛒 商城新訂單 ${r.order.orderNo}`, lines: [`顧客：${r.order.customerName}`, `金額：NT$ ${Number(r.order.total).toLocaleString("zh-TW")}`, `取貨：${r.order.shippingAddress}`], path: `/orders/view/?id=${r.order.id}` });
        } catch (e) {
          console.warn("admin notify", e);
        }
      }
      return { orderNo: r.order.orderNo, token: r.token, orderId: r.order.id, duplicate: r.duplicate };
    },
  ),

  "order.get": op("public", 60, z.object(orderRef), async (i, ctx) => {
    const r = dbReader(ctx.db);
    const o = await authorizeOrder(r, ctx.who, i);
    return { order: await publicOrder(r, o, { full: !!ctx.who.uid && o.customerUid === ctx.who.uid }) };
  }),

  "order.reportPayment": op("public", 10, z.object({ ...orderRef, last5: z.string().regex(/^\d{5}$/, "請輸入 5 位數字（可以 0 開頭）"), amount: z.string().regex(/^\d{1,7}$/).nullable().optional(), note: z.string().max(200).nullable().optional() }), async (i, ctx) => {
    const id = await runTx(ctx.db, async (t) => {
      const o = await authorizeOrder(t, ctx.who, i);
      await reportPayment(t, o, { last5: i.last5, amount: i.amount, note: i.note }, actorOf(ctx));
      return o.id;
    });
    await flush(ctx, `payment-reported-${id}`);
    try {
      const o = (await ctx.db.collection(C.orders).doc(id).get()).data()!;
      await dispatch({ db: ctx.db }, "payment", { title: `💰 顧客回報匯款 ${o.orderNo}`, lines: [`末五碼：${i.last5}`, `金額：NT$ ${Number(o.total).toLocaleString("zh-TW")}`], path: `/store/payments/` });
    } catch (e) {
      console.warn("admin notify", e);
    }
    return { message: "已收到付款回報，確認款項後會通知你" };
  }),

  "order.cancel": op("public", 10, z.object(orderRef), async (i, ctx) => {
    const id = await runTx(ctx.db, async (t) => {
      const o = await authorizeOrder(t, ctx.who, i);
      await customerCancel(t, o, actorOf(ctx));
      return o.id;
    });
    await flush(ctx, `order-cancelled-${id}`);
    return { message: "訂單已取消" };
  }),

  "lookup.request": op("public", 5, z.object({ orderNo: z.string().trim().min(5).max(40), email: z.string().trim().email("Email 格式不正確").max(200) }), async (i, ctx) => {
    const id = await runTx(ctx.db, (t) => requestCode(t, i.orderNo, i.email));
    if (id) await flush(ctx, `code-${id}`);
    return { message: "如果訂單編號與 Email 正確，驗證碼已寄到你的信箱" };
  }),

  "lookup.verify": op("public", 10, z.object({ orderNo: z.string().trim().min(5).max(40), email: z.string().trim().max(200), code: z.string().trim().regex(/^\d{6}$/, "驗證碼是 6 位數字"), claim: z.boolean().optional() }), async (i, ctx) => {
    const r = await runTx(ctx.db, async (t) => {
      const v = await verifyCode(t, i.orderNo, i.email, i.code);
      // 歸戶：已登入的會員驗證成功後，把訪客訂單加到自己的帳號
      if (v.ok && i.claim && ctx.who.uid && !v.order.customerUid) await t.update(C.orders, v.order.id, { customerUid: ctx.who.uid, customerKey: `uid:${ctx.who.uid}`, updatedAt: nowIso() });
      return v;
    });
    if (!r.ok) throw r.error;
    return { token: r.token };
  }),

  // ── 會員 ──
  "account.me": op("customer", 60, z.object({}), async (_i, ctx) => {
    const c = (await ctx.db.collection(C.shopCustomers).doc(ctx.who.uid!).get()).data() ?? {};
    return { profile: { uid: ctx.who.uid, email: ctx.who.email ?? c.contactEmail ?? null, emailVerified: !!ctx.who.emailVerified, name: c.name ?? ctx.who.name ?? "", phone: c.phone ?? "", contactEmail: c.contactEmail ?? ctx.who.email ?? "", savedStores: c.savedStores ?? [], providers: c.providers ?? [] } };
  }),
  "account.update": op("customer", 20, z.object({ name: z.string().trim().max(40), phone: z.string().trim().regex(/^(09\d{8})?$/, "手機號碼格式：09 開頭共 10 碼"), contactEmail: z.string().trim().email("Email 格式不正確").max(200).or(z.literal("")) }), async (i, ctx) => {
    await ctx.db.collection(C.shopCustomers).doc(ctx.who.uid!).set({ name: i.name, phone: i.phone, contactEmail: i.contactEmail.toLowerCase(), updatedAt: nowIso() }, { merge: true });
    return { message: "已儲存" };
  }),
  "account.removeStore": op("customer", 20, z.object({ carrier: z.string().max(10), storeId: z.string().max(10) }), async (i, ctx) => {
    await runTx(ctx.db, async (t) => {
      const c = await t.get(C.shopCustomers, ctx.who.uid!);
      if (c) await t.update(C.shopCustomers, c.id, { savedStores: ((c.savedStores as Array<Record<string, unknown>>) ?? []).filter((x) => !(x.carrier === i.carrier && x.storeId === i.storeId)) });
    });
    return { message: "已移除" };
  }),
  "account.orders": op("customer", 60, z.object({}), async (_i, ctx) => {
    const r = dbReader(ctx.db);
    const list = (await r.query(C.orders, [["customerUid", "==", ctx.who.uid]])).sort((a, b) => String(b.orderedAt).localeCompare(String(a.orderedAt)));
    const out = [];
    for (const o of list.slice(0, 50)) {
      const v = await publicOrder(r, o, { full: true });
      out.push({ id: v.id, orderNo: v.orderNo, createdAt: v.createdAt, headline: v.headline, total: v.total, itemCount: v.items.reduce((n, x) => n + x.qty, 0), image: v.items[0]?.image ?? null });
    }
    return { orders: out };
  }),

  // 會員購物車（登入後保存；訪客購物車存在瀏覽器）
  "cart.get": op("customer", 60, z.object({}), async (_i, ctx) => ({ lines: ((await ctx.db.collection(C.shopCarts).doc(ctx.who.uid!).get()).data()?.lines as unknown[]) ?? [] })),
  "cart.save": op("customer", 60, z.object({ lines, merge: z.boolean().optional() }), async (i, ctx) => {
    const merged = await ctx.db.runTransaction(async (t) => {
      const ref = ctx.db.collection(C.shopCarts).doc(ctx.who.uid!);
      const cur = ((await t.get(ref)).data()?.lines as z.infer<typeof lines>) ?? [];
      let next = i.lines;
      if (i.merge) {
        // 合併：同一商品、規格、研磨、禮盒內容才算同一行；同一行取較大數量（避免重複登入時數量加倍）
        const map = new Map(cur.map((l) => [lineKey(l), l]));
        for (const l of i.lines) {
          const k = lineKey(l);
          const prev = map.get(k);
          map.set(k, prev ? { ...l, qty: Math.max(prev.qty, l.qty) } : l);
        }
        next = [...map.values()].slice(0, 50);
      }
      t.set(ref, { lines: next, updatedAt: nowIso() });
      return next;
    });
    return { lines: merged };
  }),

  // ── 登入 ──
  "auth.redeemTicket": op("public", 20, z.object({ ticket: z.string().min(20).max(100) }), async (i, ctx) => {
    const t = await runTx(ctx.db, async (t) => {
      const d = await t.get(C.loginTickets, sha(i.ticket));
      if (!d) return null;
      await t.delete(C.loginTickets, d.id);
      return d;
    });
    if (!t || String(t.expiresAt) < nowIso()) throw new ShopError("LOGIN_REQUIRED", "登入連結已失效，請重新登入");
    return { customToken: t.customToken };
  }),
  "auth.lineLinkStart": op("customer", 10, z.object({}), async (_i, ctx) => ({ link: await lineLinkStart(ctx.db, ctx.who.uid!) })),
  /** 只在模擬器／測試環境：建立測試會員並登入（正式環境此操作不存在） */
  "dev.mockLogin": op("public", 30, z.object({ provider: z.enum(["google", "line"]), name: z.string().max(40), email: z.string().email().max(200) }), async (i, ctx) => {
    if (!ctx.allowMock) throw new ShopError("NOT_CONFIGURED", "正式環境不提供測試登入");
    const uid = `mock-${i.provider}-${sha(i.email).slice(0, 12)}`;
    await ctx.db.collection(C.shopCustomers).doc(uid).set({ providers: [i.provider], name: i.name, contactEmail: i.email.toLowerCase(), mock: true, updatedAt: nowIso() }, { merge: true });
    return { customToken: await getAuth().createCustomToken(uid, { email: i.email, mock: true }) };
  }),
};

type AnyOp = Op<z.ZodTypeAny>;

async function rateLimit(db: Firestore, key: string, max: number) {
  const minute = new Date().toISOString().slice(0, 16);
  const ref = db.collection(C.rateLimits).doc(`${sha(key).slice(0, 32)}-${minute.replace(/[^0-9]/g, "")}`);
  return db.runTransaction(async (t) => {
    const c = ((await t.get(ref)).data()?.count as number) ?? 0;
    if (c >= max) return false;
    t.set(ref, { count: c + 1, expiresAt: new Date(Date.now() + 120_000) });
    return true;
  });
}

export async function runShopOp(name: string, raw: unknown, ctx: ShopCtx) {
  const def = (SHOP_OPS as unknown as Record<string, AnyOp>)[name];
  if (!def) throw new DomainError("未知的操作", "NOT_FOUND", 404);
  if (def.auth === "customer" && !ctx.who.uid) throw new ShopError("LOGIN_REQUIRED", "請先登入");
  if (!(await rateLimit(ctx.db, `${ctx.ip ?? "?"}:${name}`, def.limit))) throw new ShopError("RATE_LIMITED", "操作太頻繁，請稍後再試");
  const parsed = def.schema.safeParse(raw ?? {});
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const iss of parsed.error.issues) fieldErrors[iss.path.join(".")] ??= iss.message;
    const e = new DomainError(Object.values(fieldErrors)[0] ?? "輸入資料有誤", "INVALID_ARGUMENT", 400);
    Object.assign(e, { fieldErrors });
    throw e;
  }
  try {
    return await def.run(parsed.data, ctx);
  } catch (e) {
    // 共用後台邏輯的「需確認」在商城一律視為狀態衝突（商城沒有人可以確認）
    if (e instanceof ConfirmError) throw new ShopError("ORDER_STATE_CONFLICT", "目前無法完成，請稍後再試或聯絡客服");
    throw e;
  }
}
