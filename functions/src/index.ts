/**
 * Cloud Functions 進入點（區域 asia-east1，臺灣）。
 *  - api：Callable，管理後台所有寫入與報表；伺服器端驗證 Firebase Auth 與管理員名單
 *  - storefront：HTTP，未來官網（伺服器對伺服器，API 金鑰）
 *  - dailyDigest：每天 08:30（臺北）寄送每日彙整到 Telegram／Email
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { setGlobalOptions } from "firebase-functions/v2";
import { HttpsError, onCall, onRequest, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineBoolean, defineString } from "firebase-functions/params";
import { z } from "zod";
import { DomainError, errorMessage } from "../../src/lib/errors";
import { runOp, type OpCtx } from "./ops";
import { CurveParseError } from "./curves/parse";
import { runTx, nowIso } from "./tx";
import { C } from "./types";
import { claimFirstAdmin, hashApiKey } from "./domain/master";
import { createOrder } from "./domain/orders";
import { notifyAfterOp, sendDailySummary } from "./notify/notify";
import { runShopOp } from "./shop/ops";
import { ShopError } from "./shop/errors";
import { defaultProvider, processOutbox } from "./shop/outbox";
import { expireOne, remindOne } from "./shop/orders";
import { storeSettingsDb } from "./shop/settings";
import { lineCallback, lineMockPage, lineStart, type LineConfig } from "./shop/line";

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: "asia-east1", maxInstances: 10 });
const BOOTSTRAP_ADMIN_EMAIL = defineString("BOOTSTRAP_ADMIN_EMAIL", { default: "" });
/** App Check 強制驗證：正式環境在 functions/.env.<專案> 設 ENFORCE_APP_CHECK=true；模擬器預設 false */
const ENFORCE_APP_CHECK = defineBoolean("ENFORCE_APP_CHECK", { default: false });
/** LINE Login 憑證：放在 functions/.env.<專案>（不進 Git）；未設定時正式環境不提供 LINE 登入 */
const LINE_CHANNEL_ID = defineString("LINE_CHANNEL_ID", { default: "" });
const LINE_CHANNEL_SECRET = defineString("LINE_CHANNEL_SECRET", { default: "" });
const IS_EMULATOR = process.env.FUNCTIONS_EMULATOR === "true";

const CODE: Record<number, ConstructorParameters<typeof HttpsError>[0]> = { 400: "invalid-argument", 401: "unauthenticated", 403: "permission-denied", 404: "not-found", 409: "failed-precondition", 422: "failed-precondition", 429: "resource-exhausted" };

function toHttpsError(e: unknown): HttpsError {
  if (e instanceof HttpsError) return e;
  if (e instanceof CurveParseError) return new HttpsError("invalid-argument", ["檔案驗證失敗：", ...e.errors].join("\n"), { code: "CURVE_PARSE", errors: e.errors });
  if (e instanceof ShopError) return new HttpsError(CODE[e.status] ?? "failed-precondition", e.message, { code: e.code, data: e.data ?? null });
  if (e instanceof DomainError) return new HttpsError(CODE[e.status] ?? "failed-precondition", e.message, { code: e.code, fieldErrors: (e as DomainError & { fieldErrors?: unknown }).fieldErrors ?? null });
  return new HttpsError("internal", errorMessage(e));
}

async function readFile(path: string) {
  if (!/^uploads\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}\.(csv|txt|alog)$/.test(path)) throw new DomainError("檔案路徑無效");
  const file = getStorage().bucket().file(path);
  const [meta] = await file.getMetadata();
  if (Number(meta.size) > 5 * 1024 * 1024) throw new DomainError("檔案過大（上限 5MB）");
  const [buf] = await file.download();
  return { buf, name: path.split("/").pop()! };
}

// App Check：正式環境於 functions/.env.<專案> 設定 ENFORCE_APP_CHECK=true，只接受帶有效 App Check 權杖（來自本網站）的呼叫；模擬器不強制
export const api = onCall({ enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 120, memory: "512MiB" }, async (req: CallableRequest<{ op?: string; input?: unknown }>) => {
  const auth = req.auth;
  if (!auth) throw new HttpsError("unauthenticated", "請先登入");
  const opName = String(req.data?.op ?? "");
  try {
    if (opName === "admin.claimFirst") {
      await runTx(db, (t) => claimFirstAdmin(t, { uid: auth.uid, email: auth.token.email ?? null, name: auth.token.name ?? null }, BOOTSTRAP_ADMIN_EMAIL.value()));
      return { ok: true, message: "已成為管理員" };
    }
    const admin = await db.collection(C.admins).doc(auth.uid).get();
    if (!admin.exists) throw new HttpsError("permission-denied", "此帳號不是管理員");
    if (admin.data()?.role === "VIEWER") throw new HttpsError("permission-denied", "權限不足");
    if (!auth.token.email_verified && process.env.FUNCTIONS_EMULATOR !== "true" && admin.data()?.requireVerified) throw new HttpsError("permission-denied", "請先驗證 Email");
    const ctx: OpCtx = { db, actor: { userId: auth.uid, name: (admin.data()?.name as string) ?? auth.token.email ?? null, ip: req.rawRequest.ip ?? null }, readFile };
    const data = await runOp(opName, req.data?.input, ctx);
    return { ok: true, data };
  } catch (e) {
    throw toHttpsError(e);
  }
});

// ── 未來官網 API（伺服器對伺服器） ──
const storefrontBody = z.object({
  externalRef: z.string().min(1).max(100),
  customer: z.object({ name: z.string().min(1).max(100), phone: z.string().max(50).optional(), email: z.string().email().max(200).optional(), address: z.string().max(500).optional() }),
  shippingMethod: z.string().max(100).optional(),
  shippingFee: z.number().min(0).max(100000).optional(),
  note: z.string().max(1000).optional(),
  items: z.array(z.object({ sku: z.string().min(1).max(60), quantity: z.number().int().min(1).max(999) })).min(1).max(50),
});

async function verifyKey(header: string | undefined, scope: string) {
  const m = /^Bearer\s+(ata_[A-Za-z0-9_-]{28,})$/.exec(header ?? "");
  if (!m) return null;
  const ref = db.collection(C.apiKeys).doc(hashApiKey(m[1]));
  const k = await ref.get();
  if (!k.exists || k.data()?.revokedAt || !(k.data()?.scopes as string[]).includes(scope)) return null;
  // 每金鑰每分鐘 60 次
  const minute = new Date().toISOString().slice(0, 16);
  const ok = await db.runTransaction(async (t) => {
    const rl = db.collection("rateLimits").doc(`${ref.id}-${minute}`);
    const c = ((await t.get(rl)).data()?.count as number) ?? 0;
    if (c >= 60) return false;
    t.set(rl, { count: c + 1, expiresAt: new Date(Date.now() + 120_000) });
    t.update(ref, { lastUsedAt: nowIso() });
    return true;
  });
  return ok ? { id: ref.id, prefix: k.data()?.prefix as string } : "LIMIT";
}

export const storefront = onRequest({ cors: false, timeoutSeconds: 60 }, async (req, res) => {
  try {
    if (req.method === "GET" && req.path.endsWith("/products")) {
      const key = await verifyKey(req.get("authorization"), "products:read");
      if (!key) return void res.status(401).json({ error: "未授權" });
      if (key === "LIMIT") return void res.status(429).json({ error: "請求過於頻繁" });
      const vs = await db.collection(C.variants).where("status", "==", "ACTIVE").get();
      const lots = await db.collection(C.lots).where("kind", "==", "FINISHED").where("status", "==", "AVAILABLE").get();
      const avail = new Map<string, number>();
      for (const l of lots.docs) avail.set(l.data().variantId, (avail.get(l.data().variantId) ?? 0) + Number(l.data().onHand) - Number(l.data().reserved));
      return void res.json(vs.docs.filter((d) => d.data().productStatus === "ACTIVE").map((d) => ({ sku: d.data().sku, name: `${d.data().productName}｜${d.data().name}`, category: d.data().category, listPrice: d.data().listPrice, salePrice: d.data().salePrice, isLimited: !!d.data().isLimited, available: d.data().stockPolicy === "NOT_TRACKED" ? null : (avail.get(d.id) ?? 0), madeToOrder: d.data().stockPolicy === "MADE_TO_ORDER" })));
    }
    if (req.method === "POST" && req.path.endsWith("/orders")) {
      const key = await verifyKey(req.get("authorization"), "orders:create");
      if (!key) return void res.status(401).json({ error: "未授權" });
      if (key === "LIMIT") return void res.status(429).json({ error: "請求過於頻繁" });
      const idem = req.get("idempotency-key");
      if (!idem || idem.length > 100) return void res.status(400).json({ error: "缺少 Idempotency-Key" });
      const parsed = storefrontBody.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: "格式錯誤", issues: parsed.error.issues });
      const b = parsed.data;
      const r = await runTx(db, async (t) => {
        const ids: string[] = [];
        for (const it of b.items) {
          const v = await t.query(C.variants, [["sku", "==", it.sku]]);
          if (!v.length || v[0].status !== "ACTIVE" || v[0].productStatus !== "ACTIVE") throw new DomainError(`商品不存在或未上架：${it.sku}`);
          ids.push(v[0].id);
        }
        return createOrder(t, { channel: "WEB", externalRef: b.externalRef, idempotencyKey: `web:${idem}`, customerName: b.customer.name, customerPhone: b.customer.phone, customerEmail: b.customer.email, shippingAddress: b.customer.address, shippingMethod: b.shippingMethod, shippingFee: b.shippingFee ?? 0, note: b.note, items: b.items.map((it, i) => ({ variantId: ids[i], quantity: it.quantity })) }, { userId: null, name: `API ${key.prefix}` });
      });
      await notifyAfterOp({ db }, "order.create", {}, { id: r.order.id, duplicate: r.duplicate });
      return void res.status(r.duplicate ? 200 : 201).json({ orderNo: r.order.orderNo, total: r.order.total, paymentStatus: r.order.paymentStatus, fulfillmentStatus: r.order.fulfillmentStatus, duplicate: r.duplicate });
    }
    res.status(404).json({ error: "Not found" });
  } catch (e) {
    res.status(e instanceof DomainError ? e.status : 500).json({ error: errorMessage(e) });
  }
});

// ── 每日彙整（每天 08:30 臺北時間） ──
export const dailyDigest = onSchedule({ schedule: "30 8 * * *", timeZone: "Asia/Taipei", timeoutSeconds: 120, retryCount: 1 }, async () => {
  const r = await sendDailySummary({ db });
  console.log("每日彙整", JSON.stringify(r));
});

// ── 官方商城 ──

/** 商城 API（公開＋顧客）：與管理員 api 分開；顧客登入（Google／LINE）可選 */
export const shop = onCall({ enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "512MiB" }, async (req: CallableRequest<{ op?: string; input?: unknown }>) => {
  const a = req.auth;
  const who = a ? { uid: a.uid, email: (a.token.email as string | undefined) ?? null, emailVerified: !!a.token.email_verified, name: (a.token.name as string | undefined) ?? null } : { uid: null };
  try {
    const data = await runShopOp(String(req.data?.op ?? ""), req.data?.input, { db, who, ip: req.rawRequest.ip ?? null, allowMock: IS_EMULATOR });
    return { ok: true, data };
  } catch (e) {
    if (!(e instanceof DomainError)) console.error("shop", req.data?.op, e);
    throw toHttpsError(e);
  }
});

/** 每 10 分鐘：逾期未付款自動取消、付款提醒、重寄失敗通知 */
export const shopTasks = onSchedule({ schedule: "every 10 minutes", timeZone: "Asia/Taipei", timeoutSeconds: 300, retryCount: 0 }, async () => {
  const r = await runShopTasks();
  console.log("shopTasks", JSON.stringify(r));
});

export async function runShopTasks(now = new Date()) {
  const s = await storeSettingsDb(db);
  const actor = { userId: null, name: "系統（付款期限）" };
  const out = { expired: 0, review: 0, reminded: 0, sent: 0 };
  const unpaid = await db.collection(C.orders).where("channel", "==", "STORE").where("paymentStatus", "in", ["UNPAID", "PENDING_CONFIRMATION", "UNDER_REVIEW"]).get();
  for (const d of unpaid.docs) {
    const st = (d.data().store ?? {}) as { paymentDeadline?: string };
    if (!st.paymentDeadline) continue;
    try {
      if (st.paymentDeadline <= now.toISOString()) {
        const r = await runTx(db, (t) => expireOne(t, d.id, now, actor));
        if (r === "expired") out.expired++;
        if (r === "review") out.review++;
      } else if (s.paymentReminderHours > 0 && (await runTx(db, (t) => remindOne(t, d.id, now, s.paymentReminderHours)))) out.reminded++;
    } catch (e) {
      console.error("expire", d.id, e);
    }
  }
  out.sent = await processOutbox(db, await defaultProvider(db), { limit: 50 });
  return out;
}

/** 有新通知寫入寄件匣就立刻寄出（交易已提交才會觸發） */
export const outboxSend = onDocumentCreated({ document: "notifyOutbox/{id}", retry: false }, async (ev) => {
  await processOutbox(db, await defaultProvider(db), { ids: [ev.params.id] });
});

function lineCfg(): LineConfig {
  const project = process.env.GCLOUD_PROJECT ?? "ata-coffee";
  const callbackUrl = IS_EMULATOR ? `http://127.0.0.1:5001/${project}/asia-east1/lineAuth/callback` : `https://asia-east1-${project}.cloudfunctions.net/lineAuth/callback`;
  return { channelId: LINE_CHANNEL_ID.value(), channelSecret: LINE_CHANNEL_SECRET.value(), callbackUrl, mock: IS_EMULATOR && !LINE_CHANNEL_ID.value() };
}

/** LINE Login：/start、/callback（模擬器另有 /mock 測試授權頁） */
export const lineAuth = onRequest({ timeoutSeconds: 30, cors: false }, async (req, res) => {
  try {
    const cfg = lineCfg();
    if (req.path.endsWith("/start")) return await lineStart(db, cfg, req, res);
    if (req.path.endsWith("/callback")) return await lineCallback(db, cfg, req, res);
    if (req.path.endsWith("/mock")) return lineMockPage(cfg, req, res);
    res.status(404).send("Not found");
  } catch (e) {
    console.error("lineAuth", e);
    res.status(500).send("登入發生錯誤，請稍後再試");
  }
});
