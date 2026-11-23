"use client";

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { D } from "./decimal";
import { fmtDate } from "./time";
import { useCol, type Row } from "./data";

export const useQS = (k: string) => useSearchParams().get(k);
/** 完成後要回去的站內路徑（?next=），只接受以單一 / 開頭的站內路徑 */
export const useNext = () => {
  const n = useSearchParams().get("next");
  return n && n.startsWith("/") && !n.startsWith("//") ? n : null;
};
/** 在連結上加上「完成後回到 next」 */
export const withNext = (href: string, next: string) => `${href}${href.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;
export const useQSList =(k: string) => (useSearchParams().get(k) ?? "").split(",").filter(Boolean);

export function Loading({ label = "載入中…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-12 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-border-strong border-t-primary" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
      讀取失敗：{message}
    </p>
  );
}

/** 統一處理載入中／錯誤／找不到 */
export function Guard({ loading, error, missing, children }: { loading?: boolean; error?: string | null; missing?: boolean; children: () => ReactNode }) {
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (missing) return <p className="py-12 text-center text-sm text-muted">找不到資料（可能已被刪除或網址錯誤）</p>;
  return <>{children()}</>;
}

// ── 表單選項 ──
export type Opt = { value: string; label: string };

export function useCoffeeOptions(): Opt[] {
  const { data } = useCol("coffees", [], "code", false);
  return data.filter((c) => !c.archivedAt).map((c) => ({ value: c.id, label: `${c.code}｜${c.nameZh}` }));
}

export function useGreenLotOptions(): Opt[] {
  const { data } = useCol("invLots", [["kind", "GREEN"]], "createdAt");
  return data.filter((l) => D(l.onHand).gt(0) && l.greenLotId).map((l) => ({ value: l.greenLotId, label: `${l.lotCode}｜${String(l.itemName).replace("生豆｜", "")}（可用 ${D(l.onHand).sub(l.reserved).toFixed(0)}g）` }));
}

export function useRoastedLotOptions(): Opt[] {
  const { data } = useCol("invLots", [["kind", "ROASTED"]], "createdAt");
  return data.filter((l) => l.status === "AVAILABLE" && D(l.onHand).gt(0)).map((l) => ({ value: l.id, label: `${l.lotCode}｜${String(l.itemName).replace("熟豆｜", "")}（可用 ${D(l.onHand).sub(l.reserved).toFixed(1)}g）` }));
}

export function useRoastBatchOptions(): Opt[] {
  const { data } = useCol("roastBatches", [], "roastedAt");
  return data.map((r) => ({ value: r.id, label: `${r.batchNo}｜${r.coffeeName}（${fmtDate(r.roastedAt)}）` }));
}

export function useEquipmentOptions(type: string): Opt[] {
  const { data } = useCol("equipment", [["type", type]], "name", false);
  return data.map((e) => ({ value: e.id, label: e.name }));
}

export function useVariantOptions(opts?: { includeBundles?: boolean; activeOnly?: boolean }): Opt[] {
  const { data } = useCol("variants", [], "sku", false);
  return data
    .filter((v) => v.status !== "ARCHIVED" && v.productStatus !== "ARCHIVED" && (opts?.includeBundles !== false || !v.isBundle) && (!opts?.activeOnly || (v.status === "ACTIVE" && v.productStatus === "ACTIVE")))
    .map((v) => ({ value: v.id, label: `${v.sku}｜${v.productName} ${v.name}（NT$${D(v.salePrice).toFixed(0)}）` }));
}

export const toOpts = (rows: Row[], label: (r: Row) => string): Opt[] => rows.map((r) => ({ value: r.id, label: label(r) }));

/** 將 Firestore 文件轉為表單預設值（null → ""） */
export const formDefaults = (r: Row | null | undefined, keys?: string[]) =>
  Object.fromEntries(Object.entries(r ?? {}).filter(([k]) => !keys || keys.includes(k)).map(([k, v]) => [k, typeof v === "boolean" ? v : v == null ? "" : typeof v === "object" ? v : String(v)]));
