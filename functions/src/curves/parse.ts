/**
 * 烘焙曲線解析 Adapter。
 *  - CSV：通用格式，支援欄位對應、mm:ss 或秒數、°C/°F、自動偵測 Artisan CSV 匯出之首行中繼資料。
 *  - Artisan .alog：依 Artisan 開源程式之存檔結構（Python dict 文字：timex / temp1(ET) / temp2(BT) / timeindex / mode）。
 *  - 其他格式（包含 Olomo 原生格式）：尚未取得可驗證之規格，未實作解析器；請先匯出 CSV 再透過欄位對應匯入。
 * 所有解析器只轉換實際存在的資料，不補值、不推估溫度。
 */
import Papa from "papaparse";

export interface CurvePoint {
  timeSec: number;
  btC: number | null;
  etC: number | null;
  rorC: number | null;
  heat: number | null;
  airflow: number | null;
  drumSpeed: number | null;
}

export interface ParsedEvent {
  type: "CHARGE" | "DRY_END" | "FC_START" | "FC_END" | "SC_START" | "DROP";
  timeSec: number;
  btC: number | null;
  etC: number | null;
}

export interface ParseResult {
  points: CurvePoint[];
  events: ParsedEvent[];
  rorComputed: boolean;
  warnings: string[];
}

export class CurveParseError extends Error {
  constructor(public errors: string[]) {
    super(errors.join("\n"));
  }
}

export type ColumnKey = "time" | "bt" | "et" | "ror" | "heat" | "airflow" | "drum";
export type ColumnMapping = Partial<Record<ColumnKey, string>>;
export const COLUMN_LABEL: Record<ColumnKey, string> = {
  time: "時間（必填）",
  bt: "豆溫 BT",
  et: "環境溫 ET",
  ror: "RoR",
  heat: "火力",
  airflow: "風門",
  drum: "轉速",
};

const PATTERNS: Record<ColumnKey, RegExp> = {
  time: /^(time1?|時間|秒|sec(onds)?|t)$/i,
  bt: /^(bt|bean ?temp|豆溫|temp2)$/i,
  et: /^(et|env(ironment)? ?temp|環境溫|temp1)$/i,
  ror: /^(ror|delta ?bt|升溫率)$/i,
  heat: /^(heat|power|burner|gas|火力)$/i,
  airflow: /^(air(flow)?|fan|damper|風門|風量)$/i,
  drum: /^(drum|drum ?speed|rpm|轉速)$/i,
};

export function preprocessCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  let body = text.replace(/^﻿/, "");
  // Artisan CSV 匯出首行為中繼資料（Date:...），跳過
  if (/^Date:/i.test(body)) body = body.slice(body.indexOf("\n") + 1);
  const res = Papa.parse<Record<string, string>>(body.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  if (res.errors.length && !res.data.length) throw new CurveParseError(res.errors.slice(0, 5).map((e) => `第 ${(e.row ?? 0) + 2} 行：${e.message}`));
  return { headers: res.meta.fields ?? [], rows: res.data };
}

export function detectMapping(headers: string[]): ColumnMapping {
  const m: ColumnMapping = {};
  for (const key of Object.keys(PATTERNS) as ColumnKey[]) {
    const found = headers.find((h) => PATTERNS[key].test(h.trim()));
    if (found) m[key] = found;
  }
  return m;
}

function parseTime(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const mmss = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(t);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function parseNum(v: string | undefined): number | null {
  if (v == null || v.trim() === "" || v.trim() === "-1") return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : NaN;
}

export function parseCsvCurve(text: string, mapping: ColumnMapping, unit: "C" | "F" = "C"): ParseResult {
  const { headers, rows } = preprocessCsv(text);
  const errors: string[] = [];
  if (!mapping.time) errors.push("請指定時間欄位");
  if (!mapping.bt && !mapping.et) errors.push("至少需要對應 BT 或 ET 其中一個溫度欄位");
  for (const [k, col] of Object.entries(mapping)) {
    if (col && !headers.includes(col)) errors.push(`對應欄位「${col}」（${COLUMN_LABEL[k as ColumnKey]}）不存在於檔案中`);
  }
  if (errors.length) throw new CurveParseError(errors);
  if (rows.length < 2) throw new CurveParseError(["資料列少於 2 筆，無法形成曲線"]);

  const toC = (f: number | null) => (f == null ? null : unit === "F" ? Math.round(((f - 32) * 5) / 9 * 10) / 10 : f);
  const points: CurvePoint[] = [];
  let prevT = -Infinity;
  rows.forEach((r, i) => {
    const line = i + 2;
    const t = parseTime(r[mapping.time!] ?? "");
    if (t == null) return errors.push(`第 ${line} 行：時間為空白`);
    if (Number.isNaN(t)) return errors.push(`第 ${line} 行：時間「${r[mapping.time!]}」格式錯誤（接受秒數或 mm:ss）`);
    if (t <= prevT) return errors.push(`第 ${line} 行：時間 ${t}s 未遞增（前一筆 ${prevT}s）`);
    prevT = t;
    const vals: Record<string, number | null> = {};
    for (const k of ["bt", "et", "ror", "heat", "airflow", "drum"] as const) {
      const col = mapping[k];
      const v = col ? parseNum(r[col]) : null;
      if (Number.isNaN(v)) errors.push(`第 ${line} 行：${COLUMN_LABEL[k]}「${r[col!]}」不是數字`);
      vals[k] = Number.isNaN(v) ? null : v;
    }
    const bt = toC(vals.bt);
    const et = toC(vals.et);
    for (const [label, v] of [["BT", bt], ["ET", et]] as const) {
      if (v != null && (v < -20 || v > 350)) errors.push(`第 ${line} 行：${label} ${v}°C 超出合理範圍（-20～350°C），請確認溫度單位`);
    }
    points.push({ timeSec: t, btC: bt, etC: et, rorC: vals.ror, heat: vals.heat, airflow: vals.airflow, drumSpeed: vals.drum });
  });
  if (errors.length) throw new CurveParseError(errors.slice(0, 20).concat(errors.length > 20 ? [`…另有 ${errors.length - 20} 個錯誤`] : []));
  const rorComputed = !mapping.ror;
  return { points: rorComputed ? withComputedRor(points) : points, events: [], rorComputed, warnings: [] };
}

/** 由實際 BT 資料計算 RoR（°C/min，30 秒視窗）。無 BT 時保持 null。 */
export function withComputedRor(points: CurvePoint[], windowSec = 30): CurvePoint[] {
  return points.map((p, i) => {
    if (p.btC == null) return { ...p, rorC: null };
    let j = i;
    while (j > 0 && p.timeSec - points[j - 1].timeSec <= windowSec) j--;
    const base = points[j];
    if (j === i || base.btC == null || p.timeSec - base.timeSec < windowSec / 2) return { ...p, rorC: null };
    const ror = ((p.btC - base.btC) / (p.timeSec - base.timeSec)) * 60;
    return { ...p, rorC: Math.round(ror * 100) / 100 };
  });
}

// ───────────── Artisan .alog ─────────────

/** 將 Python literal（dict/list/tuple/str/num/True/False/None）安全轉為 JS 值（不執行任何程式碼） */
export function parsePythonLiteral(src: string): unknown {
  let i = 0;
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const err = (m: string) => new CurveParseError([`Artisan 檔案格式錯誤（位置 ${i}）：${m}`]);
  function value(): unknown {
    ws();
    const c = src[i];
    if (c === "{") {
      i++;
      const o: Record<string, unknown> = {};
      ws();
      if (src[i] === "}") return i++, o;
      for (;;) {
        const k = value();
        ws();
        if (src[i++] !== ":") throw err("預期 ':'");
        o[String(k)] = value();
        ws();
        if (src[i] === ",") {
          i++;
          ws();
          if (src[i] === "}") return i++, o;
          continue;
        }
        if (src[i] === "}") return i++, o;
        throw err("預期 ',' 或 '}'");
      }
    }
    if (c === "[" || c === "(") {
      const close = c === "[" ? "]" : ")";
      i++;
      const a: unknown[] = [];
      ws();
      if (src[i] === close) return i++, a;
      for (;;) {
        a.push(value());
        ws();
        if (src[i] === ",") {
          i++;
          ws();
          if (src[i] === close) return i++, a;
          continue;
        }
        if (src[i] === close) return i++, a;
        throw err(`預期 ',' 或 '${close}'`);
      }
    }
    if (/[uUbBrR]/.test(c) && (src[i + 1] === "'" || src[i + 1] === '"')) i++;
    if (src[i] === "'" || src[i] === '"') {
      const q = src[i++];
      let s = "";
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") {
          const n = src[i + 1];
          const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"' };
          if (n === "u" || n === "x") {
            const len = n === "u" ? 4 : 2;
            s += String.fromCharCode(parseInt(src.slice(i + 2, i + 2 + len), 16));
            i += 2 + len;
            continue;
          }
          s += map[n] ?? n;
          i += 2;
          continue;
        }
        s += src[i++];
      }
      i++;
      return s;
    }
    const m = /^(True|False|None|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|-?inf|nan)/.exec(src.slice(i));
    if (!m) throw err(`無法辨識的內容「${src.slice(i, i + 12)}」`);
    i += m[0].length;
    if (m[0] === "True") return true;
    if (m[0] === "False") return false;
    if (m[0] === "None") return null;
    if (/inf|nan/.test(m[0])) return null;
    return Number(m[0]);
  }
  const v = value();
  ws();
  if (i < src.length) throw err("檔案結尾有多餘內容");
  return v;
}

const ALOG_EVENTS: Array<[number, ParsedEvent["type"]]> = [
  [0, "CHARGE"],
  [1, "DRY_END"],
  [2, "FC_START"],
  [3, "FC_END"],
  [4, "SC_START"],
  [6, "DROP"],
];

export function parseArtisanAlog(text: string): ParseResult {
  const data = parsePythonLiteral(text.trim()) as Record<string, unknown>;
  if (!data || typeof data !== "object") throw new CurveParseError(["Artisan 檔案內容不是字典結構"]);
  const timex = data.timex as number[] | undefined;
  const et = data.temp1 as number[] | undefined;
  const bt = data.temp2 as number[] | undefined;
  if (!Array.isArray(timex) || !Array.isArray(bt) || !Array.isArray(et)) {
    throw new CurveParseError(["找不到 Artisan 曲線欄位 timex / temp1 / temp2"]);
  }
  if (timex.length !== bt.length || timex.length !== et.length) throw new CurveParseError(["timex、temp1、temp2 長度不一致"]);
  const unitF = data.mode === "F";
  const toC = (v: number | null) => (v == null || v === -1 ? null : unitF ? Math.round(((v - 32) * 5) / 9 * 10) / 10 : v);
  const ti = Array.isArray(data.timeindex) ? (data.timeindex as number[]) : [];
  const chargeIdx = ti[0] != null && ti[0] >= 0 ? ti[0] : 0;
  const t0 = timex[chargeIdx] ?? 0;
  const warnings: string[] = [];
  if (!Array.isArray(data.timeindex)) warnings.push("檔案無 timeindex，未匯入事件，時間以紀錄起點為 0");
  const points: CurvePoint[] = [];
  for (let k = 0; k < timex.length; k++) {
    const t = Math.round((timex[k] - t0) * 100) / 100;
    if (points.length && t <= points[points.length - 1].timeSec) continue;
    points.push({ timeSec: t, btC: toC(bt[k]), etC: toC(et[k]), rorC: null, heat: null, airflow: null, drumSpeed: null });
  }
  if (points.length < 2) throw new CurveParseError(["曲線資料點少於 2 筆"]);
  const events: ParsedEvent[] = [];
  for (const [pos, type] of ALOG_EVENTS) {
    const idx = ti[pos];
    // Artisan：CHARGE 未標記時為 -1；其他事件未標記時為 0
    if (idx == null || idx < 0 || (pos !== 0 && idx === 0)) continue;
    events.push({ type, timeSec: Math.round((timex[idx] - t0) * 100) / 100, btC: toC(bt[idx]), etC: toC(et[idx]) });
  }
  return { points: withComputedRor(points), events, rorComputed: true, warnings };
}
