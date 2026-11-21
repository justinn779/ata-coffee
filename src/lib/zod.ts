import { z } from "zod";
import { parseDateOnly, parseMmSs, parseTaipeiLocal } from "./time";

/** 表單欄位 Zod 輔助：空字串視為未填 */
const blank = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);
const decimalRe = /^-?\d+(\.\d+)?$/;

export const reqStr = (label: string, max = 200) => z.string({ required_error: `請填寫${label}` }).trim().min(1, `請填寫${label}`).max(max, `${label}過長`);
export const optStr = (max = 2000) => z.preprocess((v) => (typeof v === "string" ? v.trim() || null : v ?? null), z.string().max(max).nullable());

export const reqDec = (label: string, opts?: { min?: number; positive?: boolean }) =>
  z.preprocess(
    (v) => (typeof v === "number" ? String(v) : typeof v === "string" ? v.trim().replaceAll(",", "") : v),
    z
      .string({ required_error: `請填寫${label}` })
      .min(1, `請填寫${label}`)
      .regex(decimalRe, `${label}必須為數字`)
      .refine((s) => (opts?.positive ? Number(s) > 0 : true), `${label}必須大於 0`)
      .refine((s) => (opts?.min != null ? Number(s) >= opts.min : true), `${label}不可小於 ${opts?.min}`),
  );
export const optDec = (label = "數值", opts?: { min?: number }) =>
  z.preprocess(
    (v) => {
      const b = blank(typeof v === "string" ? v.trim().replaceAll(",", "") : v);
      return b === undefined ? null : String(b);
    },
    z
      .string()
      .regex(decimalRe, `${label}必須為數字`)
      .refine((s) => (opts?.min != null ? Number(s) >= opts.min : true), `${label}不可小於 ${opts?.min}`)
      .nullable(),
  );
export const reqInt = (label: string, min = 1) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v)) : v), z.number({ required_error: `請填寫${label}`, invalid_type_error: `${label}必須為整數` }).int(`${label}必須為整數`).min(min, `${label}不可小於 ${min}`));
export const optInt = (label = "數值", min = 0, max = 100000) =>
  z.preprocess((v) => (blank(v) === undefined ? null : Number(v)), z.number({ invalid_type_error: `${label}必須為整數` }).int(`${label}必須為整數`).min(min).max(max).nullable());
export const optMmSs = (label: string) =>
  z.preprocess((v) => blank(v) ?? null, z.string().nullable()).transform((v, ctx) => {
    if (v == null) return null;
    try {
      return parseMmSs(v);
    } catch {
      ctx.addIssue({ code: "custom", message: `${label}格式請用 mm:ss` });
      return z.NEVER;
    }
  });
export const reqDateTime = (label: string) =>
  reqStr(label).transform((v, ctx) => {
    try {
      return parseTaipeiLocal(v);
    } catch {
      ctx.addIssue({ code: "custom", message: `${label}格式錯誤` });
      return z.NEVER;
    }
  });
export const reqDate = (label: string) =>
  reqStr(label).transform((v, ctx) => {
    try {
      return parseDateOnly(v);
    } catch {
      ctx.addIssue({ code: "custom", message: `${label}格式錯誤` });
      return z.NEVER;
    }
  });
export const optDate = () => z.preprocess((v) => blank(v) ?? null, z.string().nullable()).transform((v) => (v ? parseDateOnly(v) : null));
export const optId = () => z.preprocess((v) => blank(v) ?? null, z.string().uuid("選項無效").nullable());
export const reqId = (label: string) => z.string({ required_error: `請選擇${label}` }).uuid(`請選擇${label}`);
export const bool = () => z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean());
export const enumOf = <T extends string>(vals: readonly [T, ...T[]], label: string) => z.enum(vals, { errorMap: () => ({ message: `請選擇${label}` }) });
/** "true"/"false" 字串（下拉選單）→ boolean */
export const boolStr = () => z.preprocess((v) => v === true || v === "true", z.boolean());
export const optEmail = () => z.preprocess((v) => v || null, z.string().email("Email 格式錯誤").nullable());
export const nativeEnumOf = <T extends z.EnumLike>(e: T, label: string) => z.nativeEnum(e, { errorMap: () => ({ message: `請選擇${label}` }) });
export const enumList = <T extends string>(vals: readonly [T, ...T[]], label: string) => z.enum(vals as [T, ...T[]], { errorMap: () => ({ message: `請選擇${label}` }) });
/** Firestore 版：日期時間轉為 ISO 字串、日期轉為 'YYYY-MM-DD' */
export const isoDateTime = (label: string) => reqDateTime(label).transform((d) => d.toISOString());
export const isoDate = (label: string) => reqDate(label).transform((d) => d.toISOString().slice(0, 10));
export const optIsoDate = () => optDate().transform((d) => (d ? d.toISOString().slice(0, 10) : null));
export const docId = (label: string) => z.string({ required_error: `請選擇${label}` }).min(1, `請選擇${label}`).max(200);
export const optDocId = () => z.preprocess((v) => (v === "" || v == null ? null : v), z.string().max(200).nullable());
