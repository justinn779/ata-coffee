/** 通知（Telegram／Gmail）：以假的管道測試，不連線外部服務 */
import { beforeEach, describe, expect, it } from "vitest";
import { runOp, type OpCtx } from "../../functions/src/ops";
import type { Channels } from "../../functions/src/notify/channels";
import { C } from "../../functions/src/types";
import { baseFixture, ctx, db, docs, receiveGreen, resetDb } from "../helpers";

let sent: Array<{ to: string; text: string }>;
let fail = false;
const fake: Channels = {
  telegram: async (chatId, html) => {
    if (fail) throw new Error("Telegram 傳送失敗：測試");
    sent.push({ to: `tg:${chatId}`, text: html });
  },
  telegramMe: async () => ({ username: "ata_test_bot" }),
  telegramUpdates: async () => [{ chatId: "777", title: "ATA 群組", text: `/start ${(await db.collection(C.settings).doc("notify").get()).data()?.linkCode}` }],
  email: async (to, subject, text) => {
    sent.push({ to: `email:${to.join(",")}`, text: `${subject}\n${text}` });
  },
  emailVerify: async () => {},
};
const nctx: OpCtx = { ...ctx, channels: fake };
const op = <T = Record<string, unknown>>(name: string, input: unknown) => runOp(name, input, nctx) as Promise<T>;
/** 烘焙（經由假通知管道，才能收到低庫存通知） */
const roast = (greenLotId: string, roasterId: string, green = 500, roasted = 425) => op<{ id: string }>("roast.create", { greenLotId, roasterId, roastedAt: "2026-11-10T14:00", greenWeightG: String(green), roastedWeightG: String(roasted) });
const tg = () => sent.filter((s) => s.to.startsWith("tg:")).map((s) => s.text);

beforeEach(async () => {
  await resetDb();
  sent = [];
  fail = false;
});

async function linked() {
  await db.collection(C.settings).doc("notify").set({ telegramChatId: "42", telegramBot: "ata_test_bot", hasTelegramToken: true, emailTo: ["owner@ata.test"], gmailUser: "notify@ata.test", hasGmailPassword: true });
}

describe("通知設定", () => {
  it("設定機器人金鑰：驗證後只存在 secrets，設定與稽核紀錄不含金鑰", async () => {
    const token = "123456789:AAH" + "x".repeat(32);
    await op("notify.setSecrets", { telegramBotToken: token });
    const st = (await db.collection(C.settings).doc("notify").get()).data()!;
    expect(st).toMatchObject({ hasTelegramToken: true, telegramBot: "ata_test_bot" });
    expect(JSON.stringify(st)).not.toContain(token);
    expect((await db.collection("secrets").doc("notify").get()).data()?.telegramBotToken).toBe(token);
    expect(JSON.stringify(await docs(C.audit))).not.toContain(token);
    await expect(op("notify.setSecrets", { telegramBotToken: "not-a-token" })).rejects.toThrow(/格式不正確/);
  });

  it("連結聊天室：產生驗證碼 → 偵測到 /start 驗證碼後儲存聊天室並回覆確認", async () => {
    await db.collection(C.settings).doc("notify").set({ hasTelegramToken: true, telegramBot: "ata_test_bot" });
    const r = await op<{ code: string; link: string }>("notify.linkStart", {});
    expect(r.link).toBe(`https://t.me/ata_test_bot?start=${r.code}`);
    await op("notify.linkDetect", {});
    const st = (await db.collection(C.settings).doc("notify").get()).data()!;
    expect(st).toMatchObject({ telegramChatId: "777", telegramChatTitle: "ATA 群組", linkCode: null });
    expect(tg()[0]).toContain("已連結");
  });

  it("Gmail 密碼需先設定寄件帳號；收件 Email 格式驗證", async () => {
    await expect(op("notify.setSecrets", { gmailAppPassword: "abcd efgh ijkl mnop" })).rejects.toThrow(/寄件 Gmail/);
    await expect(op("notify.save", { gmailUser: "notify@ata.test", emailTo: "a@ata.test, bad-email" })).rejects.toThrow(/格式錯誤/);
    await op("notify.save", { gmailUser: "notify@ata.test", emailTo: "a@ata.test，b@ata.test", dailyTelegram: true, dailyEmail: true, tg_newOrder: true });
    await op("notify.setSecrets", { gmailAppPassword: "abcd efgh ijkl mnop" });
    const st = (await db.collection(C.settings).doc("notify").get()).data()!;
    expect(st).toMatchObject({ emailTo: ["a@ata.test", "b@ata.test"], hasGmailPassword: true, tgEvents: { newOrder: true, payment: false } });
  });
});

describe("即時通知", () => {
  it("新訂單、顧客回報匯款、接單後分裝、低庫存（只在新跌破時通知一次）", async () => {
    await linked();
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id, 5000);
    // 熟豆 425g 低於預設門檻 500g → 低庫存通知
    const r = await roast(g.id, f.roaster.id, 500, 425);
    expect(tg().filter((t) => t.includes("庫存低於門檻"))).toHaveLength(1);
    expect(tg().join()).toContain("熟豆｜耶加雪菲 水洗");
    sent = [];
    // 200g 無現貨 → 接單後分裝；熟豆持續低於門檻但不重複通知
    const o = await op<{ id: string }>("order.create", { customerName: "王小明", items: [{ variantId: f.v200.id, quantity: "1" }] });
    const msgs = tg();
    expect(msgs.some((t) => t.includes("新訂單") && t.includes("王小明") && t.includes("NT$ 780"))).toBe(true);
    expect(msgs.some((t) => t.includes("待分裝") && t.includes("YRG-200"))).toBe(true);
    expect(msgs.some((t) => t.includes("庫存低於門檻"))).toBe(false);
    expect(msgs.join()).toContain(`/orders/view/?id=${o.id}`);
    sent = [];
    await op("order.markPending", { orderId: o.id, reference: "末五碼 12345" });
    expect(tg()).toHaveLength(1);
    expect(tg()[0]).toContain("顧客回報匯款");
    expect(tg()[0]).toContain("12345");
    // 預設即時通知不寄 Email
    expect(sent.filter((s) => s.to.startsWith("email:"))).toHaveLength(0);
    expect(r).toBeTruthy();
  });

  it("關閉的事件不通知；傳送失敗不影響業務操作並記錄失敗", async () => {
    await linked();
    await db.collection(C.settings).doc("notify").set({ tgEvents: { newOrder: false, payment: true, lowStock: false, packaging: false } }, { merge: true });
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id, 5000);
    await roast(g.id, f.roaster.id, 500, 425);
    expect(tg()).toHaveLength(0);
    fail = true;
    await db.collection(C.settings).doc("notify").set({ tgEvents: { newOrder: true } }, { merge: true });
    const o = await op<{ id: string }>("order.create", { customerName: "陳小華", items: [{ variantId: f.v200.id, quantity: "1" }] });
    expect(o.id).toBeTruthy();
    const log = await docs(C.notifyLog);
    expect(log.some((l) => l.ok === false && String(l.error).includes("測試"))).toBe(true);
    await expect(op("notify.test", {})).rejects.toThrow(/Telegram/);
  });
});

describe("每日彙整", () => {
  it("彙整待確認匯款、可出貨、待分裝、低庫存，並同時寄 Telegram 與 Email", async () => {
    await linked();
    const f = await baseFixture();
    const g = await receiveGreen(f.coffee.id, 5000);
    await roast(g.id, f.roaster.id, 500, 425);
    const o = await op<{ id: string }>("order.create", { customerName: "林先生", items: [{ variantId: f.v200.id, quantity: "1" }] });
    await op("order.markPending", { orderId: o.id, reference: "11111" });
    sent = [];
    await op("notify.dailyNow", {});
    const t = tg()[0];
    expect(t).toContain("每日彙整");
    expect(t).toContain("待確認匯款：1 筆");
    expect(t).toContain("林先生");
    expect(t).toContain("待分裝：1 張");
    expect(t).toMatch(/低庫存：\d+ 項/);
    const mail = sent.find((s) => s.to === "email:owner@ata.test");
    expect(mail?.text).toContain("【ATA Coffee】📋 每日彙整");
  });

  it("沒有待辦時顯示「今天沒有待處理事項」", async () => {
    await linked();
    await op("notify.dailyNow", {});
    expect(tg()[0]).toContain("今天沒有待處理事項");
  });
});
