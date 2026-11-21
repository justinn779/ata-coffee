type F = { [k: string]: unknown; restStartDays?: number | null; peakFromDays?: number | null; peakToDays?: number | null; shelfLifeDays?: number | null };

/** 熟豆賞味資訊（批次覆寫優先，否則使用咖啡豆預設）；用戶端與 Functions 共用 */
export function freshnessOf(batch: F, coffee: F) {
  const pick = (k: "restStartDays" | "peakFromDays" | "peakToDays" | "shelfLifeDays") => (batch[k] != null ? { value: Number(batch[k]), source: "批次覆寫" } : coffee[k] != null ? { value: Number(coffee[k]), source: "咖啡豆預設" } : null);
  return { restStart: pick("restStartDays"), peakFrom: pick("peakFromDays"), peakTo: pick("peakToDays"), shelfLife: pick("shelfLifeDays") };
}
