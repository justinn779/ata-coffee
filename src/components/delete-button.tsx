"use client";

import { opAction } from "@/lib/api";
import { ActionDialog } from "./action-dialog";

/**
 * 刪除按鈕（含確認）。預設呼叫 master.delete（主檔），仍被其他資料使用時後端會拒絕並說明原因。
 * 其他資料（烘焙、生豆採購、訂單…）傳入對應的 op。
 */
export function DeleteButton({
  what,
  name,
  col,
  id,
  op = "master.delete",
  payload,
  description,
  redirectTo,
  inline = true,
}: {
  what: string;
  name?: string;
  col?: string;
  id: string;
  op?: string;
  payload?: Record<string, unknown>;
  description?: string;
  redirectTo?: string;
  /** 表格列內的小按鈕；false 為頁首的紅色按鈕 */
  inline?: boolean;
}) {
  return (
    <ActionDialog
      label={inline ? <span className="text-danger">刪除</span> : "刪除"}
      size={inline ? "sm" : "md"}
      variant={inline ? "ghost" : "danger"}
      title={`刪除${what}${name ? `「${name}」` : ""}？`}
      description={description ?? "刪除後無法復原（操作紀錄會保留）。如果這筆資料還被其他紀錄使用，系統會提示，不會刪除。"}
      confirmLabel="確認刪除"
      payload={payload ?? (col ? { col, id } : { id })}
      action={opAction(op)}
      successMessage="已刪除"
      redirectTo={redirectTo}
    />
  );
}
