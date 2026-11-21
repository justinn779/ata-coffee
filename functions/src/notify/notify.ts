/**
 * 通知：每日彙整（08:30）與即時事件（新訂單、顧客回報匯款、庫存低於門檻、接單後分裝待處理）。
 * 通知是「盡力而為」：傳送失敗只記錄在 notifyLog，不影響業務操作（操作已在交易中完成）。
 */
import type { Firestore } from "firebase-admin/firestore";
import { D, toDb } from "../../../src/lib/decimal";
import { addDaysYmd, todayTaipei } from "../../../src/lib/time";
import { C, type Actor } from "../types";
import { DEFAULT_SETTINGS } from "../domain/core";
import { esc, realChannels, type Channels, type NotifySecrets } from "./channels";

export const NOTIFY_EVENTS = ["newOrder", "payment", "lowStock", "packaging"] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number] | "daily" | "test";
export const EVENT_LABEL: Record<NotifyEvent, string> = { newOrder: "新訂單", payment: "顧客回報匯款", lowStock: "庫存低於門檻", packaging: "接單後分裝待處理", daily: "每日彙整", test: "測試" };

export interface NotifySettings {
  telegramChatId: string | null;
  telegramChatTitle: string | null;
  telegramBot: string | null;
  linkCode: string | null;
  linkCodeAt: string | null;
  gmailUser: string | null;
  emailTo: string[];
  hasTelegramToken: boolean;
  hasGmailPassword: boolean;
  dailyTelegram: boolean;
  dailyEmail: boolean;
  tgEvents: Record<(typeof NOTIFY_EVENTS)[number], boolean>;
  emailEvents: Record<(typeof NOTIFY_EVENTS)[number], boolean>;
}

export const DEFAULT_NOTIFY: NotifySettings = {
  telegramChatId: null,
  telegramChatTitle: null,
  telegramBot: null,
  linkCode: null,
  linkCodeAt: null,
  gmailUser: null,
  emailTo: [],
  hasTelegramToken: false,
  hasGmailPassword: false,
  dailyTelegram: true,
  dailyEmail: true,
  tgEvents: { newOrder: true, payment: true, lowStock: true, packaging: true },
  emailEvents: { newOrder: false, payment: false, lowStock: false, packaging: false },
};

export const SECRETS_COL = "secrets";
export const SITE_URL = (process.env.SITE_URL || "https://justinn779.github.io/ata-coffee").replace(/\/$/, "");

export interface NotifyCtx {
  db: Firestore;
  /** 測試用：注入假的通知管道 */
  channels?: Channels;
}

export async function getNotifySettings(db: Firestore): Promise<NotifySettings> {
  const s = await db.collection(C.settings).doc("notify").get();
  const d = (s.data() ?? {}) as Partial<NotifySettings>;
  return { ...DEFAULT_NOTIFY, ...d, tgEvents: { ...DEFAULT_NOTIFY.tgEvents, ...(d.tgEvents ?? {}) }, emailEvents: { ...DEFAULT_NOTIFY.emailEvents, ...(d.emailEvents ?? {}) } };
}

export async function getChannels(ctx: NotifyCtx): Promise<Channels> {
  if (ctx.channels) return ctx.channels;
  const s = await ctx.db.collection(SECRETS_COL).doc("notify").get();
  const settings = await getNotifySettings(ctx.db);
  return realChannels({ ...(s.data() as NotifySecrets | undefined), gmailUser: settings.gmailUser });
}

export interface Msg {
  title: string;
  lines: string[];
  /** 站內路徑，例如 /orders/view/?id=xxx */
  path?: string;
}

const toHtml = (m: Msg) => [`<b>${esc(m.title)}</b>`, ...m.lines.map(esc), m.path ? `\n<a href="${esc(SITE_URL + m.path)}">開啟後台</a>` : ""].filter(Boolean).join("\n");
const toText = (m: Msg) => [m.title, "", ...m.lines, m.path ? `\n開啟後台：${SITE_URL}${m.path}` : ""].join("\n");
const toEmailHtml = (m: Msg) =>
  `<div style="font-family:sans-serif;font-size:14px;line-height:1.6"><h3 style="margin:0 0 8px">${esc(m.title)}</h3>${m.lines.map((l) => `<div>${esc(l) || "&nbsp;"}</div>`).join("")}${m.path ? `<p><a href="${esc(SITE_URL + m.path)}">開啟後台</a></p>` : ""}<p style="color:#888;font-size:12px">ATA Coffee 管理系統自動通知</p></div>`;

/** 依設定送出到已啟用的管道；回傳各管道結果（不丟出錯誤） */
export async function dispatch(ctx: NotifyCtx, event: NotifyEvent, m: Msg, opts?: { force?: boolean }) {
  const s = await getNotifySettings(ctx.db);
  const ch = await getChannels(ctx);
  const wantTg = opts?.force || (event === "daily" ? s.dailyTelegram : event === "test" ? true : s.tgEvents[event]);
  const wantEmail = opts?.force || (event === "daily" ? s.dailyEmail : event === "test" ? true : s.emailEvents[event]);
  const results: Array<{ channel: "telegram" | "email"; ok: boolean; error?: string }> = [];
  if (wantTg && s.telegramChatId && ch.telegram) {
    try {
      await ch.telegram(s.telegramChatId, toHtml(m));
      results.push({ channel: "telegram", ok: true });
    } catch (e) {
      results.push({ channel: "telegram", ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (wantEmail && s.emailTo.length && ch.email) {
    try {
      await ch.email(s.emailTo, `【ATA Coffee】${m.title}`, toText(m), toEmailHtml(m));
      results.push({ channel: "email", ok: true });
    } catch (e) {
      results.push({ channel: "email", ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (results.length) {
    const at = new Date().toISOString();
    const batch = ctx.db.batch();
    for (const r of results) batch.set(ctx.db.collection(C.notifyLog).doc(), { at, event, title: m.title, channel: r.channel, ok: r.ok, error: r.error ?? null });
    await batch.commit();
  }
  return results;
}

// ───────────── 即時事件 ─────────────

const money = (v: unknown) => `NT$ ${D(v as string).toDecimalPlaces(0).toNumber().toLocaleString("zh-TW")}`;
const qty = (v: unknown, unit: string) => (unit === "G" ? `${D(v as string).toDecimalPlaces(1).toString()} g` : `${D(v as string).toDecimalPlaces(0).toString()} 件`);

async function orderMsgs(db: Firestore, orderId: string, isNew: boolean): Promise<Array<[NotifyEvent, Msg]>> {
  const o = (await db.collection(C.orders).doc(orderId).get()).data();
  if (!o) return [];
  const items = (await db.collection(C.orderItems).where("orderId", "==", orderId).get()).docs.map((d) => d.data());
  const out: Array<[NotifyEvent, Msg]> = [];
  const itemLines = items.map((i) => `・${i.nameSnapshot} ×${i.quantity}`);
  if (isNew) {
    out.push(["newOrder", { title: `🛒 新訂單 ${o.orderNo}`, lines: [`顧客：${o.customerName}`, `金額：${money(o.total)}`, `通路：${o.channel === "WEB" ? "官網" : o.channel === "MANUAL" ? "手動建立" : "其他"}`, ...itemLines, o.note ? `備註：${o.note}` : ""].filter(Boolean), path: `/orders/view/?id=${orderId}` }]);
  }
  if (o.fulfillmentStatus === "AWAITING_PACKAGING") {
    const pos = (await db.collection(C.productionOrders).where("orderId", "==", orderId).get()).docs.map((d) => d.data()).filter((p) => p.status === "PLANNED");
    if (pos.length) out.push(["packaging", { title: `📦 待分裝：訂單 ${o.orderNo}`, lines: [...pos.map((p) => `・${p.orderNo}：${p.variantName ?? p.sku} ×${p.plannedQty}（預計 ${p.plannedDate}）`), "現貨不足，已預留熟豆，完成分裝後訂單會自動轉為可出貨。"], path: `/production/` }]);
  }
  return out;
}

/** 計算目前低於門檻的品項（與 Dashboard 相同規則） */
export async function lowStockItems(db: Firestore) {
  const [items, lots, inv] = await Promise.all([db.collection(C.items).get(), db.collection(C.lots).where("status", "==", "AVAILABLE").get(), db.collection(C.settings).doc("inventory").get()]);
  const s = { ...DEFAULT_SETTINGS.inventory, ...(inv.data() ?? {}) } as Record<string, number>;
  const defLow: Record<string, number> = { GREEN: s.lowGreenG, ROASTED: s.lowRoastedG, FINISHED: s.lowFinishedPcs, MATERIAL: 0 };
  const avail = new Map<string, ReturnType<typeof D>>();
  for (const l of lots.docs) avail.set(l.data().itemId, (avail.get(l.data().itemId) ?? D(0)).add(D(l.data().onHand).sub(l.data().reserved)));
  return items.docs
    .map((d) => ({ id: d.id, ...(d.data() as { name: string; kind: string; unit: string; isActive?: boolean; lowStockThreshold?: string | null }) }))
    .filter((i) => i.isActive !== false)
    .map((i) => ({ ...i, available: avail.get(i.id) ?? D(0), threshold: i.lowStockThreshold != null ? D(i.lowStockThreshold) : D(defLow[i.kind] ?? 0) }))
    .filter((i) => i.threshold.gt(0) && i.available.lt(i.threshold));
}

/** 只通知「新跌破」門檻的品項；回升後再跌破會再通知一次 */
async function lowStockMsg(db: Firestore): Promise<Msg | null> {
  const low = await lowStockItems(db);
  const ref = db.collection(C.settings).doc("notifyState");
  const prev = new Set(((await ref.get()).data()?.lowItemIds as string[] | undefined) ?? []);
  await ref.set({ lowItemIds: low.map((i) => i.id), updatedAt: new Date().toISOString() }, { merge: true });
  const fresh = low.filter((i) => !prev.has(i.id));
  if (!fresh.length) return null;
  return { title: `⚠️ 庫存低於門檻（${fresh.length} 項）`, lines: fresh.map((i) => `・${i.name}：可用 ${qty(toDb(i.available, 3), i.unit)}（門檻 ${qty(toDb(i.threshold, 3), i.unit)}）`), path: `/inventory/?low=1` };
}

/** 會讓庫存減少的操作：完成後檢查低庫存 */
const STOCK_OPS = new Set(["order.create", "order.update", "order.ship", "production.create", "production.complete", "roast.create", "inventory.adjust", "inventory.count", "inventory.lotStatus", "cupping.create", "cupping.update", "brew.create", "brew.update"]);

/** 業務操作成功後觸發即時通知（不丟出錯誤） */
export async function notifyAfterOp(ctx: NotifyCtx, op: string, input: Record<string, unknown>, result: unknown) {
  try {
    const msgs: Array<[NotifyEvent, Msg]> = [];
    const r = (result ?? {}) as Record<string, unknown>;
    if (op === "order.create" && r.id && !r.duplicate) msgs.push(...(await orderMsgs(ctx.db, r.id as string, true)));
    if (op === "order.update" && r.id) msgs.push(...(await orderMsgs(ctx.db, r.id as string, false)));
    if (op === "order.markPending" && input.orderId) {
      const o = (await ctx.db.collection(C.orders).doc(input.orderId as string).get()).data();
      if (o && o.paymentStatus === "PENDING_CONFIRMATION") msgs.push(["payment", { title: `💰 顧客回報匯款 ${o.orderNo}`, lines: [`顧客：${o.customerName}`, `金額：${money(o.total)}`, `匯款資訊：${o.paymentReference ?? "（未填）"}`, "請核對入帳後到訂單頁按「確認匯款」。"], path: `/orders/view/?id=${input.orderId}` }]);
    }
    if (STOCK_OPS.has(op)) {
      const m = await lowStockMsg(ctx.db);
      if (m) msgs.push(["lowStock", m]);
    }
    for (const [ev, m] of msgs) await dispatch(ctx, ev, m);
  } catch (e) {
    console.error("通知失敗", op, e);
  }
}

// ───────────── 每日彙整 ─────────────

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

export async function buildDailySummary(db: Firestore, now = new Date()): Promise<Msg> {
  const today = todayTaipei();
  const [orders, pos, lots, inv] = await Promise.all([
    db.collection(C.orders).where("fulfillmentStatus", "in", ["PENDING", "AWAITING_PACKAGING", "READY_TO_SHIP"]).get(),
    db.collection(C.productionOrders).where("status", "==", "PLANNED").get(),
    db.collection(C.lots).where("status", "==", "AVAILABLE").get(),
    db.collection(C.settings).doc("inventory").get(),
  ]);
  const open = orders.docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
  const unpaid = open.filter((o) => o.paymentStatus === "UNPAID");
  const pending = open.filter((o) => o.paymentStatus === "PENDING_CONFIRMATION");
  const ready = open.filter((o) => o.fulfillmentStatus === "READY_TO_SHIP");
  const low = await lowStockItems(db);
  const warnDays = Number((inv.data()?.expiryWarnDays as number | undefined) ?? DEFAULT_SETTINGS.inventory.expiryWarnDays);
  const warnBefore = addDaysYmd(now, warnDays);
  const expiring = lots.docs.map((d) => d.data()).filter((l) => D(l.onHand).gt(0) && l.expiryDate && l.expiryDate <= warnBefore).sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)));
  const yStart = new Date(new Date(`${addDaysYmd(now, -1)}T00:00:00+08:00`).getTime()).toISOString();
  const tStart = new Date(`${today}T00:00:00+08:00`).toISOString();
  const yOrders = (await db.collection(C.orders).where("orderedAt", ">=", yStart).where("orderedAt", "<", tStart).get()).docs.map((d) => d.data()).filter((o) => o.fulfillmentStatus !== "CANCELLED");
  const list = <T>(arr: T[], f: (x: T) => string, max = 5) => [...arr.slice(0, max).map((x) => `　・${f(x)}`), ...(arr.length > max ? [`　…另有 ${arr.length - max} 筆`] : [])];
  const dow = WEEK[new Date(`${today}T12:00:00+08:00`).getUTCDay()];
  const lines = [
    `昨日新訂單：${yOrders.length} 筆，${money(yOrders.reduce((s, o) => s.add(o.total), D(0)).toString())}`,
    "",
    `💰 待確認匯款：${pending.length} 筆`,
    ...list(pending, (o) => `${o.orderNo} ${o.customerName} ${money(o.total)}`),
    `🧾 未付款：${unpaid.length} 筆`,
    ...list(unpaid, (o) => `${o.orderNo} ${o.customerName} ${money(o.total)}`),
    `🚚 可出貨：${ready.length} 筆`,
    ...list(ready, (o) => `${o.orderNo} ${o.customerName}`),
    `📦 待分裝：${pos.size} 張`,
    ...list(
      pos.docs.map((d) => d.data()),
      (p) => `${p.orderNo} ${p.sku ?? ""} ×${p.plannedQty}${p.mode === "MADE_TO_ORDER" ? "（訂單）" : ""}`,
    ),
    `⚠️ 低庫存：${low.length} 項`,
    ...list(low, (i) => `${i.name} 可用 ${qty(toDb(i.available, 3), i.unit)}`),
    `⏳ ${warnDays} 天內到期：${expiring.length} 批`,
    ...list(expiring, (l) => `${l.lotCode} ${l.itemName} 到期 ${l.expiryDate}`),
  ];
  const nothing = !pending.length && !unpaid.length && !ready.length && !pos.size && !low.length && !expiring.length;
  return { title: `📋 每日彙整 ${today}（週${dow}）`, lines: nothing ? [...lines.slice(0, 2), "今天沒有待處理事項 ✅"] : lines, path: "/" };
}

export async function sendDailySummary(ctx: NotifyCtx) {
  return dispatch(ctx, "daily", await buildDailySummary(ctx.db));
}

export type { Actor };
