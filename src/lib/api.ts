"use client";

import { httpsCallable } from "firebase/functions";
import { fb } from "./firebase";
import type { ActionResult } from "./action-result";
import { askConfirm, toast } from "@/components/toast";

/**
 * 呼叫 Cloud Functions 的業務操作。所有寫入一律經由此處（瀏覽器無法直接寫入 Firestore）。
 * 回傳統一格式，錯誤訊息為繁體中文；欄位錯誤會對應到表單欄位。
 */
export async function callOp<T = Record<string, unknown>>(op: string, input: unknown = {}): Promise<ActionResult<T & { id?: string; message?: string }>> {
  try {
    const fn = httpsCallable<{ op: string; input: unknown }, { ok: boolean; data?: T; message?: string }>(fb().fns, "api", { timeout: 120_000 });
    const res = await fn({ op, input });
    const data = (res.data.data ?? {}) as T & { id?: string; message?: string; warnings?: string[] };
    // 照樣存檔但有提醒（例如時間順序、庫存變負數）：另外顯示一則黃色提醒
    if (data && typeof data === "object" && Array.isArray(data.warnings) && data.warnings.length) toast(data.warnings.join("\n"), "warn");
    return { ok: true, data, message: (data && typeof data === "object" && "message" in data ? (data.message as string) : undefined) ?? res.data.message };
  } catch (e) {
    const err = e as { message?: string; code?: string; details?: { code?: string; fieldErrors?: Record<string, string> | null } };
    // 資料之間有關聯：先提醒，使用者確認後帶 force 重新送出
    if (err.details?.code === "CONFIRM" && input && typeof input === "object" && !(input as Record<string, unknown>).force) {
      if (await askConfirm(err.message ?? "")) return callOp<T>(op, { ...(input as Record<string, unknown>), force: true });
      return { ok: false, error: "已取消，沒有儲存" };
    }
    const msg = err.code === "functions/unauthenticated" ? "登入已逾時，請重新登入" : err.code === "functions/internal" && !err.message ? "系統發生錯誤，請稍後再試" : (err.message ?? "系統發生錯誤");
    return { ok: false, error: msg, fieldErrors: err.details?.fieldErrors ?? undefined };
  }
}

/** 給 EntityForm / ActionDialog 使用：產生綁定操作名稱的 action，成功時可附加導向 */
export const opAction =
  (op: string, extra?: Record<string, unknown>, redirect?: (data: Record<string, unknown>) => string) =>
  async (values: Record<string, unknown>) => {
    const r = await callOp(op, { ...values, ...extra });
    if (r.ok && redirect) return { ...r, data: { ...(r.data ?? {}), redirect: redirect((r.data ?? {}) as Record<string, unknown>) } };
    return r;
  };
