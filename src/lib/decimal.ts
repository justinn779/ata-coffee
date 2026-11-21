import Decimal from "decimal.js";

// 所有金額、重量最終計算使用 decimal.js，避免浮點誤差。
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Num = Decimal | number | string;

export const D = (v: Num | null | undefined): Decimal => new Decimal(v == null ? 0 : v.toString());

export const ZERO = new Decimal(0);

/** 轉為儲存用字串（Firestore 以字串保存十進位數，避免浮點誤差） */
export const toDb = (v: Num, dp?: number): string => {
  const d = D(v);
  return (dp == null ? d : d.toDecimalPlaces(dp)).toFixed(dp ?? undefined);
};

export const money = (v: Num) => D(v).toDecimalPlaces(2);
export const grams = (v: Num) => D(v).toDecimalPlaces(3);

export function percent(numerator: Num, denominator: Num, dp = 3): Decimal | null {
  const den = D(denominator);
  if (den.isZero()) return null;
  return D(numerator).div(den).mul(100).toDecimalPlaces(dp);
}

export const fmtMoney = (v: Num | null | undefined) =>
  v == null ? "—" : "NT$ " + D(v).toDecimalPlaces(0).toNumber().toLocaleString("zh-TW");

export const fmtMoney2 = (v: Num | null | undefined) =>
  v == null
    ? "—"
    : "NT$ " +
      D(v).toNumber().toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtGrams = (v: Num | null | undefined, dp = 0) =>
  v == null ? "—" : D(v).toDecimalPlaces(dp).toNumber().toLocaleString("zh-TW", { maximumFractionDigits: dp }) + " g";

export const fmtNum = (v: Num | null | undefined, dp = 2) =>
  v == null ? "—" : D(v).toDecimalPlaces(dp).toNumber().toLocaleString("zh-TW", { maximumFractionDigits: dp });

export const fmtPct = (v: Num | null | undefined, dp = 1) => (v == null ? "—" : D(v).toDecimalPlaces(dp).toString() + "%");

export { Decimal };
