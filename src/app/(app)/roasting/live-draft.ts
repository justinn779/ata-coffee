import { fmtSec } from "@/lib/time";

/** 平板即時紀錄：每 30 秒一個紀錄點 */
export const STEP = 30;

export type Ctl = { heat: number | null; air: number | null; drum: number | null };
export type LiveRow = Ctl & { bt: number | null };
export type EventKey = "TP" | "DRY_END" | "FC_START" | "FC_END" | "DROP";
export const EVENT_LABEL: Record<EventKey, string> = { TP: "回溫點", DRY_END: "轉黃", FC_START: "一爆", FC_END: "一爆結束", DROP: "下豆" };

export interface LiveDraft {
  greenLotId: string;
  roasterId: string;
  greenWeightG: string;
  chargeTempC: string;
  steps: Ctl;
  /** 目前的火力、風門、鍋速（沿用到之後的紀錄點） */
  ctl: Ctl;
  /** 入豆時刻（epoch ms） */
  startedAt: number;
  /** 入豆時刻（烘焙表單用的本地時間字串） */
  roastedAtLocal: string;
  /** 下豆時間（自入豆起算秒數）；null = 進行中 */
  droppedAt: number | null;
  /** key = 秒數（30 的倍數） */
  rows: Record<string, LiveRow>;
  events: Partial<Record<EventKey, { t: number; bt: number | null }>>;
  beep: boolean;
}

/** 下次開始時沿用的設定 */
export type LivePrefs = Pick<LiveDraft, "roasterId" | "steps" | "ctl" | "beep">;

const KEY = "roast-live-v1";
const PREFS = "roast-live-prefs-v1";

const read = <T,>(k: string): T | null => {
  try {
    const s = localStorage.getItem(k);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

export const loadLive = () => read<LiveDraft>(KEY);
export const saveLive = (d: LiveDraft) => write(KEY, d);
export const clearLive = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {}
};
export const loadPrefs = () => read<LivePrefs>(PREFS);
export const savePrefs = (p: LivePrefs) => write(PREFS, p);

/** 依時間排序的紀錄點 */
export function sortedRows(d: LiveDraft) {
  return Object.entries(d.rows)
    .map(([t, r]) => ({ t: Number(t), ...r }))
    .sort((a, b) => a.t - b.t);
}

/** 豆溫上升率（°C／分）：與上一個有溫度的紀錄點比較 */
export function rorAt(rows: Array<{ t: number; bt: number | null }>, t: number) {
  const i = rows.findIndex((r) => r.t === t);
  if (i <= 0 || rows[i].bt == null) return null;
  for (let j = i - 1; j >= 0; j--) {
    const p = rows[j];
    if (p.bt != null) return Math.round((((rows[i].bt as number) - p.bt) / (t - p.t)) * 60 * 10) / 10;
  }
  return null;
}

/** 轉成「開始新一批烘焙」表單的預設值與曲線點 */
export function liveToRoastForm(d: LiveDraft) {
  const mm = (t?: number | null) => (t == null ? "" : fmtSec(t));
  const s = (v?: number | null) => (v == null ? "" : String(v));
  const e = d.events;
  return {
    defaults: {
      greenLotId: d.greenLotId,
      roasterId: d.roasterId,
      roastedAt: d.roastedAtLocal,
      greenWeightG: d.greenWeightG,
      chargeTempC: d.chargeTempC,
      turningPointSec: mm(e.TP?.t),
      turningPointTempC: s(e.TP?.bt),
      dryEndSec: mm(e.DRY_END?.t),
      firstCrackStartSec: mm(e.FC_START?.t),
      firstCrackEndSec: mm(e.FC_END?.t),
      dropSec: mm(d.droppedAt ?? e.DROP?.t),
      dropTempC: s(e.DROP?.bt),
    },
    curvePoints: sortedRows(d).map((r) => ({ t: r.t, bt: r.bt, heat: r.heat, air: r.air, drum: r.drum })),
  };
}
