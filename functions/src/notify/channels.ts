/**
 * 通知管道：Telegram Bot API、Gmail（SMTP＋應用程式密碼）。
 * 金鑰存在 Firestore secrets/notify（安全規則禁止瀏覽器讀寫，只有 Cloud Functions 可存取），由管理員在系統設定輸入。
 * 測試時以 OpCtx.channels 注入假的管道，不會連線外部服務。
 */
import nodemailer from "nodemailer";
import { DomainError } from "../../../src/lib/errors";

export interface Channels {
  telegram?: (chatId: string, html: string) => Promise<void>;
  telegramMe?: () => Promise<{ username: string }>;
  telegramUpdates?: () => Promise<Array<{ chatId: string; title: string; text: string }>>;
  email?: (to: string[], subject: string, text: string, html: string) => Promise<void>;
  emailVerify?: () => Promise<void>;
}

export interface NotifySecrets {
  telegramBotToken?: string | null;
  gmailUser?: string | null;
  gmailAppPassword?: string | null;
}

const TG = "https://api.telegram.org";

async function tgCall<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${TG}/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!r.ok || !j.ok) {
    if (r.status === 401) throw new DomainError("Telegram 機器人金鑰無效，請重新設定");
    if (r.status === 403) throw new DomainError("Telegram 機器人被封鎖或已被移出聊天室，請重新連結");
    throw new DomainError(`Telegram 傳送失敗：${j.description ?? r.status}`);
  }
  return j.result as T;
}

export function realChannels(s: NotifySecrets): Channels {
  const ch: Channels = {};
  const token = s.telegramBotToken;
  if (token) {
    ch.telegram = async (chatId, html) => {
      await tgCall(token, "sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    };
    ch.telegramMe = async () => ({ username: (await tgCall<{ username: string }>(token, "getMe")).username });
    ch.telegramUpdates = async () => {
      const ups = await tgCall<Array<{ message?: { chat: { id: number; title?: string; first_name?: string; username?: string }; text?: string } }>>(token, "getUpdates", { timeout: 0, allowed_updates: ["message"] });
      return ups.filter((u) => u.message?.text).map((u) => ({ chatId: String(u.message!.chat.id), title: u.message!.chat.title ?? u.message!.chat.first_name ?? u.message!.chat.username ?? "", text: u.message!.text! }));
    };
  }
  if (s.gmailUser && s.gmailAppPassword) {
    const transport = nodemailer.createTransport({ service: "gmail", auth: { user: s.gmailUser, pass: s.gmailAppPassword.replace(/\s+/g, "") } });
    ch.email = async (to, subject, text, html) => {
      try {
        await transport.sendMail({ from: `"ATA Coffee 管理系統" <${s.gmailUser}>`, to, subject, text, html });
      } catch (e) {
        throw new DomainError(`Email 寄送失敗：${gmailError(e)}`);
      }
    };
    ch.emailVerify = async () => {
      try {
        await transport.verify();
      } catch (e) {
        throw new DomainError(`Gmail 驗證失敗：${gmailError(e)}`);
      }
    };
  }
  return ch;
}

function gmailError(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  if (/535|Username and Password not accepted|BadCredentials/i.test(m)) return "帳號或應用程式密碼錯誤（需使用 16 碼的「應用程式密碼」，不是 Gmail 登入密碼）";
  return m.slice(0, 200);
}

/** Telegram HTML 模式需跳脫特殊字元 */
export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
