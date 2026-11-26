/**
 * 通知寄件匣（Transactional Outbox）。
 *  - 業務交易內寫入 notifyOutbox/{去重鍵}：交易失敗就不會有通知；同一鍵只會有一筆 → 不重複寄送
 *  - 交易提交後由觸發器（onDocumentCreated）與排程（重試）寄出；寄送失敗不影響訂單
 *  - NotificationProvider 介面：目前 Email，保留 LINE 擴充
 */
import type { Firestore } from "firebase-admin/firestore";
import nodemailer from "nodemailer";
import { D } from "../../../src/lib/decimal";
import { nowIso, type Tx } from "../tx";
import { C } from "../types";
import { SECRETS_COL, SITE_URL } from "../notify/notify";
import { storeSettingsDb, type StoreSettings } from "./settings";

export type Template =
  | "ORDER_CREATED"
  | "PAYMENT_REMINDER"
  | "PAYMENT_REPORTED"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_ISSUE"
  | "PREORDER_DELAYED"
  | "ORDER_SHIPPED"
  | "ARRIVED"
  | "LOGISTICS_ISSUE"
  | "ORDER_CANCELLED"
  | "REFUNDED"
  | "VERIFY_CODE";

export interface OutboxInput {
  to: string;
  template: Template;
  orderId?: string;
  data?: Record<string, unknown>;
}

export async function enqueue(tx: Tx, key: string, m: OutboxInput) {
  const id = key.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 300);
  if (!m.to) return;
  if (await tx.get(C.outbox, id)) return; // 去重
  tx.set(C.outbox, id, { channel: "EMAIL", to: m.to, template: m.template, orderId: m.orderId ?? null, data: m.data ?? {}, status: "PENDING", attempts: 0, nextAttemptAt: nowIso(), lastError: null, createdAt: nowIso(), sentAt: null });
}

export interface Rendered {
  to: string;
  subject: string;
  text: string;
  html: string;
}
export interface NotificationProvider {
  channel: "EMAIL" | "LINE";
  name: string;
  send(m: Rendered): Promise<void>;
}

/** 開發／模擬器：信件寫到 devMailbox（不寄出），預覽環境可在後台查看 */
export function mockProvider(db: Firestore): NotificationProvider {
  return {
    channel: "EMAIL",
    name: "mock",
    async send(m) {
      await db.collection("devMailbox").add({ ...m, at: nowIso() });
    },
  };
}

/** 正式：Gmail SMTP（沿用通知設定的寄件信箱與應用程式密碼；金鑰只存在 secrets） */
export async function gmailProvider(db: Firestore): Promise<NotificationProvider | null> {
  const sec = (await db.collection(SECRETS_COL).doc("notify").get()).data() ?? {};
  const set = (await db.collection(C.settings).doc("notify").get()).data() ?? {};
  const user = set.gmailUser as string | undefined;
  const pass = sec.gmailAppPassword as string | undefined;
  if (!user || !pass) return null;
  const transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass: pass.replace(/\s+/g, "") } });
  return {
    channel: "EMAIL",
    name: "gmail",
    async send(m) {
      await transport.sendMail({ from: `"ATA Coffee" <${user}>`, to: m.to, subject: m.subject, text: m.text, html: m.html });
    },
  };
}

export async function defaultProvider(db: Firestore): Promise<NotificationProvider | null> {
  if (process.env.FUNCTIONS_EMULATOR === "true" || process.env.FIRESTORE_EMULATOR_HOST) return mockProvider(db);
  return gmailProvider(db);
}

const BACKOFF_MIN = [1, 5, 30, 120, 720];

/** 寄出待寄通知（可重複呼叫；以交易「認領」避免兩個執行者重複寄送） */
export async function processOutbox(db: Firestore, provider: NotificationProvider | null, opts?: { ids?: string[]; limit?: number }) {
  const now = nowIso();
  const ids = opts?.ids ?? (await db.collection(C.outbox).where("status", "in", ["PENDING", "RETRY"]).where("nextAttemptAt", "<=", now).limit(opts?.limit ?? 30).get()).docs.map((d) => d.id);
  const settings = await storeSettingsDb(db);
  let sent = 0;
  for (const id of ids) {
    const ref = db.collection(C.outbox).doc(id);
    const claimed = await db.runTransaction(async (t) => {
      const s = await t.get(ref);
      const d = s.data();
      if (!d || !["PENDING", "RETRY"].includes(d.status) || d.nextAttemptAt > nowIso()) return null;
      t.update(ref, { status: "SENDING", nextAttemptAt: new Date(Date.now() + 5 * 60_000).toISOString() });
      return d;
    });
    if (!claimed) continue;
    try {
      if (!provider) throw new Error("尚未設定寄件信箱（系統設定 → 通知 → Gmail）");
      const m = await render(db, settings, claimed as OutboxInput & { to: string });
      await provider.send(m);
      await ref.update({ status: "SENT", sentAt: nowIso(), attempts: Number(claimed.attempts) + 1, provider: provider.name, subject: m.subject, data: scrub(claimed.data) });
      sent++;
    } catch (e) {
      const attempts = Number(claimed.attempts) + 1;
      const failed = attempts > BACKOFF_MIN.length;
      await ref.update({ status: failed ? "FAILED" : "RETRY", attempts, lastError: (e instanceof Error ? e.message : String(e)).slice(0, 300), nextAttemptAt: new Date(Date.now() + (BACKOFF_MIN[attempts - 1] ?? 720) * 60_000).toISOString(), data: failed ? scrub(claimed.data) : claimed.data });
    }
  }
  return sent;
}

/** 寄出後移除一次性資料（訂單連結權杖、驗證碼） */
const scrub = (d: unknown) => {
  const o = { ...((d as Record<string, unknown>) ?? {}) };
  if ("token" in o) o.token = "（已移除）";
  if ("code" in o) o.code = "（已移除）";
  return o;
};

// ───────────── 品牌信件版型 ─────────────

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const nt = (v: unknown) => `NT$ ${D((v as string) ?? 0).toDecimalPlaces(0).toNumber().toLocaleString("zh-TW")}`;
const fmt = (iso: unknown) => (iso ? new Date(new Date(String(iso)).getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : "");

function layout(title: string, rows: Array<[string, string]>, body: string[], cta?: { label: string; url: string }, image?: string | null) {
  const html = `<!doctype html><html lang="zh-Hant"><body style="margin:0;background:#FCFAF6;color:#24211E;font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif">
<div style="max-width:520px;margin:0 auto;padding:40px 24px">
<img src="${esc(SITE_URL)}/brand/logo.png" alt="ATA Coffee" width="72" style="display:block;margin:0 0 32px">
<h1 style="font-size:20px;font-weight:500;margin:0 0 24px;color:#594235">${esc(title)}</h1>
${body.map((p) => `<p style="font-size:14px;line-height:1.8;margin:0 0 12px">${esc(p)}</p>`).join("")}
${rows.length ? `<table style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:8px 0;border-top:1px solid #F0EBE2;color:#7a6d62;width:40%">${esc(k)}</td><td style="padding:8px 0;border-top:1px solid #F0EBE2;text-align:right">${esc(v)}</td></tr>`).join("")}</table>` : ""}
${image ? `<p style="margin:0 0 24px"><img src="${esc(image)}" alt="轉帳 QR Code" width="160" style="display:block;background:#fff;padding:8px"></p>` : ""}
${cta ? `<a href="${esc(cta.url)}" style="display:inline-block;background:#594235;color:#FCFAF6;text-decoration:none;padding:12px 24px;border-radius:4px;font-size:14px">${esc(cta.label)}</a>` : ""}
<p style="font-size:12px;color:#9a8f85;margin:40px 0 0">ATA Coffee｜用一杯咖啡，開啟每段獨特體驗。<br>此信件由系統自動寄出，請勿直接回覆。</p>
</div></body></html>`;
  const text = [title, "", ...body, "", ...rows.map(([k, v]) => `${k}：${v}`), cta ? `\n${cta.label}：${cta.url}` : "", "\nATA Coffee"].join("\n");
  return { html, text };
}

async function render(db: Firestore, s: StoreSettings, m: OutboxInput & { to: string }): Promise<Rendered> {
  const o = m.orderId ? ((await db.collection(C.orders).doc(m.orderId).get()).data() ?? {}) : {};
  const st = (o.store ?? {}) as Record<string, unknown>;
  const no = String(o.orderNo ?? "");
  const lookup = `${SITE_URL}/shop/lookup/?no=${encodeURIComponent(no)}`;
  const orderUrl = m.data?.token ? `${SITE_URL}/shop/order/?t=${encodeURIComponent(String(m.data.token))}` : lookup;
  const bank = (st.bank ?? s.bank) as StoreSettings["bank"];
  const payRows: Array<[string, string]> = [
    ["應付金額", nt(o.total)],
    ["付款期限", fmt(st.paymentDeadline)],
    ["銀行", `${bank.bankName}（${bank.bankCode}）`],
    ["帳號", bank.accountNo],
    ["戶名", bank.accountName],
  ];
  const base: Array<[string, string]> = [["訂單編號", no]];
  const mk = (subject: string, title: string, rows: Array<[string, string]>, body: string[], cta?: { label: string; url: string }, image?: string | null) => ({ to: m.to, subject: `【ATA Coffee】${subject}`, ...layout(title, rows, body, cta, image) });
  switch (m.template) {
    case "ORDER_CREATED":
      return mk(`訂單成立 ${no}`, "謝謝你的訂購", [...base, ...payRows, ["預計出貨", String(st.estShipDate ?? "")]], ["請在付款期限前完成轉帳，並回報帳號末五碼。"], { label: "查看訂單與回報付款", url: orderUrl }, bank.qrImage || null);
    case "PAYMENT_REMINDER":
      return mk(`付款即將到期 ${no}`, "付款即將到期", [...base, ...payRows], ["完成轉帳後，請回報帳號末五碼。逾期訂單會自動取消。"], { label: "回報付款", url: orderUrl }, bank.qrImage || null);
    case "PAYMENT_REPORTED":
      return mk(`已收到付款回報 ${no}`, "已收到你的付款回報", base, ["我們確認款項後會再通知你。"], { label: "查看訂單", url: orderUrl });
    case "PAYMENT_CONFIRMED":
      return mk(`付款確認 ${no}`, "付款已確認", [...base, ["金額", nt(o.total)], ["預計出貨", String(st.estShipDate ?? "")]], ["我們開始準備你的咖啡。"], { label: "查看訂單", url: orderUrl });
    case "PAYMENT_ISSUE":
      return mk(`付款需要確認 ${no}`, "付款資訊需要確認", [...base, ["說明", String(m.data?.reason ?? "")]], ["請確認轉帳資訊後重新回報，或聯絡客服。"], { label: "查看訂單", url: orderUrl });
    case "PREORDER_DELAYED":
      return mk(`預購出貨日更新 ${no}`, "預購出貨日更新", [...base, ["新的預計出貨日", String(m.data?.shipDate ?? "")], ...(m.data?.note ? ([["說明", String(m.data.note)]] as Array<[string, string]>) : [])], ["很抱歉讓你久等，有任何問題歡迎聯絡客服。"], { label: "查看訂單", url: orderUrl });
    case "ORDER_SHIPPED": {
      const sh = (o.shipment ?? {}) as Record<string, unknown>;
      const pk = (st.pickup ?? {}) as Record<string, unknown>;
      return mk(`已出貨 ${no}`, "已出貨", [...base, ["取貨門市", `${pk.carrierLabel ?? ""} ${pk.storeName ?? ""}`], ...(sh.trackingNo ? ([["物流單號", String(sh.trackingNo)]] as Array<[string, string]>) : [])], ["到店後會再通知你，請記得攜帶證件取貨。"], { label: "查看訂單", url: orderUrl });
    }
    case "ARRIVED":
      return mk(`已到店 ${no}`, "已到達取貨門市", base, ["請在門市規定期限內取貨。"], { label: "查看訂單", url: orderUrl });
    case "LOGISTICS_ISSUE":
      return mk(`物流狀態通知 ${no}`, "物流配送有狀況", base, ["我們正在處理，會再與你聯繫。"], { label: "查看訂單", url: orderUrl });
    case "ORDER_CANCELLED":
      return mk(`訂單已取消 ${no}`, "訂單已取消", [...base, ["原因", String(o.cancelReason ?? "")]], ["如有疑問請聯絡客服。"]);
    case "REFUNDED":
      return mk(`退款通知 ${no}`, "退款已處理", [...base, ["退款金額", nt(m.data?.amount)]], ["款項會退回你提供的帳戶，入帳時間依銀行作業為準。"]);
    case "VERIFY_CODE":
      return mk(`查詢訂單驗證碼`, "訂單查詢驗證碼", [["驗證碼", String(m.data?.code ?? "")], ["有效時間", "10 分鐘"]], ["如果不是你本人操作，請忽略這封信。"]);
  }
}
