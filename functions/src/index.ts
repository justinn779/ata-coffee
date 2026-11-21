/**
 * Cloud Functions 進入點（區域 asia-east1，臺灣）。
 *  - api：Callable，管理後台所有寫入與報表；伺服器端驗證 Firebase Auth 與管理員名單
 *  - storefront：HTTP，未來官網（伺服器對伺服器，API 金鑰）
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { setGlobalOptions } from "firebase-functions/v2";
import { HttpsError, onCall, onRequest, type CallableRequest } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { z } from "zod";
import { DomainError, errorMessage } from "../../src/lib/errors";
import { runOp, type OpCtx } from "./ops";
import { CurveParseError } from "./curves/parse";
import { runTx, nowIso } from "./tx";
import { C } from "./types";
import { claimFirstAdmin, hashApiKey } from "./domain/master";
import { createOrder } from "./domain/orders";

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: "asia-east1", maxInstances: 10 });
const BOOTSTRAP_ADMIN_EMAIL = defineString("BOOTSTRAP_ADMIN_EMAIL", { default: "" });

const CODE: Record<number, ConstructorParameters<typeof HttpsError>[0]> = { 400: "invalid-argument", 401: "unauthenticated", 403: "permission-denied", 404: "not-found", 409: "failed-precondition", 422: "failed-precondition", 429: "resource-exhausted" };

function toHttpsError(e: unknown): HttpsError {
  if (e instanceof HttpsError) return e;
  if (e instanceof CurveParseError) return new HttpsError("invalid-argument", ["檔案驗證失敗：", ...e.errors].join("\n"), { code: "CURVE_PARSE", errors: e.errors });
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
export const api = onCall({ enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true", timeoutSeconds: 120, memory: "512MiB" }, async (req: CallableRequest<{ op?: string; input?: unknown }>) => {
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
      return void res.status(r.duplicate ? 200 : 201).json({ orderNo: r.order.orderNo, total: r.order.total, paymentStatus: r.order.paymentStatus, fulfillmentStatus: r.order.fulfillmentStatus, duplicate: r.duplicate });
    }
    res.status(404).json({ error: "Not found" });
  } catch (e) {
    res.status(e instanceof DomainError ? e.status : 500).json({ error: errorMessage(e) });
  }
});
