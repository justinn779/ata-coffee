import { TZDate } from "@date-fns/tz";
import { format, differenceInCalendarDays, addDays } from "date-fns";

export const TZ = "Asia/Taipei";

const inTz = (d: Date | string) => new TZDate(new Date(d), TZ);

export const fmtDate = (d: Date | string | null | undefined) => (d ? format(inTz(d), "yyyy-MM-dd") : "—");
export const fmtTime = (d: Date | string | null | undefined) => (d ? format(inTz(d), "HH:mm") : "—");
export const fmtDateTime = (d: Date | string | null | undefined) => (d ? format(inTz(d), "yyyy-MM-dd HH:mm") : "—");

/** @db.Date 欄位（無時區的日期）以 UTC 午夜儲存，直接以 UTC 取日期字串 */
export const fmtDbDate = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

/** 秒數 → mm:ss */
export const fmtSec = (s: number | null | undefined) => {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
};

/** 解析 mm:ss 或純秒數 */
export function parseMmSs(v: string | null | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const t = v.trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(\d+):([0-5]?\d)$/.exec(t);
  if (!m) throw new Error(`時間格式錯誤：${v}（請使用 mm:ss）`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 臺北時區的烘後天數（以日曆日計算） */
export function restDays(roastedAt: Date, at: Date): number {
  return differenceInCalendarDays(inTz(at), inTz(roastedAt));
}

/** 將臺北當地 datetime-local 字串（YYYY-MM-DDTHH:mm）轉為 UTC Date */
export function parseTaipeiLocal(v: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(v.trim());
  if (!m) throw new Error(`日期格式錯誤：${v}`);
  const [, y, mo, d, h = "00", mi = "00"] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h - 8, +mi));
}

/** 'YYYY-MM-DD' → @db.Date 用的 UTC 午夜 */
export const parseDateOnly = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`日期格式錯誤：${v}`);
  return new Date(v + "T00:00:00.000Z");
};

/** 臺北今日日期字串 */
export const todayTaipei = () => format(inTz(new Date()), "yyyy-MM-dd");
export const nowTaipeiLocal = () => format(inTz(new Date()), "yyyy-MM-dd'T'HH:mm");
export const toTaipeiLocalInput = (d: Date) => format(inTz(d), "yyyy-MM-dd'T'HH:mm");

/** 臺北日期 + N 天 → @db.Date */
export function addDaysDateOnly(base: Date, days: number): Date {
  const local = format(addDays(inTz(base), days), "yyyy-MM-dd");
  return parseDateOnly(local);
}

/** 臺北某月的 UTC 起訖 [start, end) */
export function monthRangeTaipei(ym: string): { start: Date; end: Date } {
  const [y, m] = ym.split("-").map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1, -8)),
    end: new Date(Date.UTC(y, m, 1, -8)),
  };
}
export const currentMonthTaipei = () => format(inTz(new Date()), "yyyy-MM");
