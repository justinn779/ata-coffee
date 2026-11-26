"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Minus, Plus, Delete, Volume2, VolumeX } from "lucide-react";
import { fmtSec, nowTaipeiLocal } from "@/lib/time";
import { useCol } from "@/lib/data";
import { useGreenLotOptions } from "@/lib/page";
import { Card, Notice, PageHeader, cn } from "@/components/ui";
import { EVENT_LABEL, STEP, clearLive, loadLive, loadPrefs, rorAt, saveLive, savePrefs, sortedRows, type Ctl, type EventKey, type LiveDraft } from "../live-draft";

/**
 * 烘豆即時紀錄（平板）：入豆後開始計時，每 30 秒一個紀錄點，記錄豆溫、火力、風門、鍋速。
 * 紀錄存在這台裝置（重新整理、螢幕關閉都不會遺失），下豆後帶入「開始新一批烘焙」表單過帳。
 */
export default function RoastLivePage() {
  const [d, setD] = useState<LiveDraft | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setD(loadLive());
    setReady(true);
  }, []);
  const update = (fn: (x: LiveDraft) => LiveDraft) =>
    setD((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      saveLive(next);
      return next;
    });
  if (!ready) return null;
  return (
    <>
      {!d && <PageHeader title="烘豆即時紀錄" description="平板邊烘邊記：每 30 秒一個紀錄點，記錄豆溫、火力、風門、鍋速" back={{ href: "/roasting/", label: "烘豆紀錄" }} />}
      {d ? (
        <Running
          d={d}
          update={update}
          onDiscard={() => {
            clearLive();
            setD(null);
          }}
        />
      ) : (
        <Setup
          onStart={(nd) => {
            saveLive(nd);
            setD(nd);
          }}
        />
      )}
    </>
  );
}

// ───────────── 提示音、螢幕常亮 ─────────────

let audio: AudioContext | null = null;
function beep(freq = 880) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.18;
    o.connect(g);
    g.connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.18);
  } catch {}
  try {
    navigator.vibrate?.(80);
  } catch {}
}

function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const req = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {}
    };
    void req();
    const onVis = () => document.visibilityState === "visible" && void req();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
  }, [on]);
}

// ───────────── 開始前設定 ─────────────

const field = "h-14 w-full rounded-xl border border-border bg-surface px-4 text-lg text-fg";
const CTL: Array<[keyof Ctl, string]> = [
  ["heat", "火力"],
  ["air", "風門"],
  ["drum", "鍋速"],
];
const numOrNull = (v: string) => (v.trim() === "" || isNaN(Number(v)) ? null : Number(v));

function Setup({ onStart }: { onStart: (d: LiveDraft) => void }) {
  const greens = useGreenLotOptions();
  const roasters = useCol("roasters", [], "name", false);
  const [prefs] = useState(() => loadPrefs());
  const [f, setF] = useState({ greenLotId: "", roasterId: prefs?.roasterId ?? "", greenWeightG: "", chargeTempC: "" });
  const [ctl, setCtl] = useState<Record<keyof Ctl, string>>({ heat: String(prefs?.ctl.heat ?? ""), air: String(prefs?.ctl.air ?? ""), drum: String(prefs?.ctl.drum ?? "") });
  const [steps, setSteps] = useState<Record<keyof Ctl, string>>({ heat: String(prefs?.steps.heat ?? 5), air: String(prefs?.steps.air ?? 1), drum: String(prefs?.steps.drum ?? 1) });
  const roasterId = f.roasterId || roasters.data[0]?.id || "";
  const start = () => {
    beep(1046); // 首次點擊解鎖平板的音效
    const c: Ctl = { heat: numOrNull(ctl.heat), air: numOrNull(ctl.air), drum: numOrNull(ctl.drum) };
    const st: Ctl = { heat: numOrNull(steps.heat) ?? 5, air: numOrNull(steps.air) ?? 1, drum: numOrNull(steps.drum) ?? 1 };
    const beepOn = prefs?.beep ?? true;
    savePrefs({ roasterId, steps: st, ctl: c, beep: beepOn });
    const charge = numOrNull(f.chargeTempC);
    onStart({
      ...f,
      roasterId,
      steps: st,
      ctl: c,
      startedAt: Date.now(),
      roastedAtLocal: nowTaipeiLocal(),
      droppedAt: null,
      rows: { 0: { bt: charge, ...c } },
      events: {},
      beep: beepOn,
    });
  };
  return (
    <Card className="p-5 md:p-6">
      <div className="grid gap-5 md:grid-cols-2">
        <label className="grid gap-1.5 md:col-span-2">
          <span className="text-sm text-muted">生豆批次（也可以下豆後再選）</span>
          <select className={field} value={f.greenLotId} onChange={(e) => setF({ ...f, greenLotId: e.target.value })}>
            <option value="">（未選擇）</option>
            {greens.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm text-muted">烘豆機</span>
          <select className={field} value={roasterId} onChange={(e) => setF({ ...f, roasterId: e.target.value })}>
            {roasters.data.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm text-muted">投入生豆重量（g）</span>
          <input className={field} inputMode="decimal" value={f.greenWeightG} onChange={(e) => setF({ ...f, greenWeightG: e.target.value })} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm text-muted">入豆溫（°C）</span>
          <input className={field} inputMode="decimal" value={f.chargeTempC} onChange={(e) => setF({ ...f, chargeTempC: e.target.value })} />
        </label>
      </div>
      <h2 className="mt-6 mb-2 text-sm font-medium">起始設定與每次加減量</h2>
      <div className="grid grid-cols-3 gap-3">
        {CTL.map(([k, label]) => (
          <div key={k} className="grid gap-2 rounded-xl border border-border p-3">
            <span className="font-medium">{label}</span>
            <label className="grid gap-1">
              <span className="text-xs text-muted">起始值</span>
              <input aria-label={`${label}起始值`} className={cn(field, "h-12")} inputMode="decimal" value={ctl[k]} onChange={(e) => setCtl({ ...ctl, [k]: e.target.value })} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted">每按一次加減</span>
              <input aria-label={`${label}每次加減`} className={cn(field, "h-12")} inputMode="decimal" value={steps[k]} onChange={(e) => setSteps({ ...steps, [k]: e.target.value })} />
            </label>
          </div>
        ))}
      </div>
      <button type="button" onClick={start} className="mt-6 h-20 w-full rounded-2xl bg-primary text-2xl font-semibold text-primary-fg active:opacity-80">
        入豆・開始計時
      </button>
      <p className="mt-3 text-center text-xs text-muted">紀錄存在這台平板，重新整理或螢幕關閉都不會遺失；計時中會盡量保持螢幕常亮。</p>
    </Card>
  );
}

// ───────────── 計時與紀錄 ─────────────

const round2 = (n: number) => Math.round(n * 100) / 100;
const show = (v: number | null | undefined) => (v == null ? "—" : String(v));
/** 與手機／平板數字鍵盤相同：1 2 3 在上，最下排是 小數點、0、刪除 */
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"];

function Running({ d, update, onDiscard }: { d: LiveDraft; update: (fn: (x: LiveDraft) => LiveDraft) => void; onDiscard: () => void }) {
  const router = useRouter();
  const live = d.droppedAt == null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [live]);
  useWakeLock(live);

  const elapsed = d.droppedAt ?? Math.max(0, Math.floor((now - d.startedAt) / 1000));
  const nearest = Math.round(elapsed / STEP) * STEP;
  const [editing, setEditing] = useState<number | null>(null); // 修改某個過去的紀錄點
  const [editCtl, setEditCtl] = useState<Ctl>(d.ctl);
  const [entry, setEntry] = useState("");
  const mark = editing ?? nearest;
  const rows = sortedRows(d);
  const lastBt = [...rows].reverse().find((r) => r.bt != null)?.bt ?? null;

  // 每到新的 30 秒提示
  const [flash, setFlash] = useState(false);
  const lastSlot = useRef(Math.floor(elapsed / STEP));
  useEffect(() => {
    const slot = Math.floor(elapsed / STEP);
    if (slot === lastSlot.current) return;
    lastSlot.current = slot;
    if (!live) return;
    if (d.beep) beep();
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 700);
    return () => clearTimeout(t);
  }, [elapsed, live, d.beep]);

  const curCtl = editing != null ? editCtl : d.ctl;
  const changeCtl = (k: keyof Ctl, dir: 1 | -1) => {
    const step = d.steps[k] ?? 1;
    const v = round2((curCtl[k] ?? 0) + dir * step);
    if (editing != null) return setEditCtl({ ...editCtl, [k]: v });
    // 調整立即記在目前的紀錄點（保留已記的豆溫）
    update((x) => ({ ...x, ctl: { ...x.ctl, [k]: v }, rows: { ...x.rows, [nearest]: { bt: x.rows[nearest]?.bt ?? null, ...x.ctl, [k]: v } } }));
  };
  const record = () => {
    const bt = entry === "" ? (d.rows[mark]?.bt ?? null) : Number(entry);
    if (entry !== "" && isNaN(bt as number)) return;
    const c = editing != null ? editCtl : d.ctl;
    update((x) => ({ ...x, rows: { ...x.rows, [mark]: { bt, ...c } } }));
    setEntry("");
    setEditing(null);
  };
  const startEdit = (t: number) => {
    const r = d.rows[t];
    setEditing(t);
    setEntry(r?.bt != null ? String(r.bt) : "");
    setEditCtl(r ? { heat: r.heat, air: r.air, drum: r.drum } : d.ctl);
  };
  const cancelEdit = () => {
    setEditing(null);
    setEntry("");
  };
  const removeRow = (t: number) =>
    update((x) => {
      const r = { ...x.rows };
      delete r[t];
      return { ...x, rows: r };
    });
  const markEvent = (k: EventKey) => {
    const has = d.events[k];
    if (k === "DROP" && !window.confirm("確定下豆？計時會停止。")) return;
    if (k !== "DROP" && has && !window.confirm(`已在 ${fmtSec(has.t)} 記過「${EVENT_LABEL[k]}」，要改成現在嗎？`)) return;
    const bt = entry !== "" && !isNaN(Number(entry)) ? Number(entry) : lastBt;
    update((x) => ({ ...x, events: { ...x.events, [k]: { t: elapsed, bt } }, droppedAt: k === "DROP" ? elapsed : x.droppedAt }));
    if (entry !== "") setEntry("");
  };
  const key = (k: string) => {
    if (k === "del") return setEntry((e) => e.slice(0, -1));
    if (k === "." && entry.includes(".")) return;
    if (entry.replace(".", "").length >= 5) return;
    setEntry((e) => e + k);
  };

  const all = new Set<number>(rows.map((r) => r.t));
  for (let t = 0; t <= (live ? nearest : elapsed); t += STEP) all.add(t);
  const marks = [...all].sort((a, b) => b - a);
  const eventsAt = (t: number) => (Object.entries(d.events) as Array<[EventKey, { t: number }]>).filter(([, e]) => Math.round(e.t / STEP) * STEP === t).map(([k]) => EVENT_LABEL[k]);
  const progress = ((elapsed % STEP) / STEP) * 100;
  const nextMark = (Math.floor(elapsed / STEP) + 1) * STEP;

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-bg text-fg">
      <div className="roast-live p-3">
        {/* 上：計時列 */}
        <div data-area="top" className={cn("flex items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2 transition-colors", flash && "bg-primary-soft")}>
          <Link href="/roasting/" className="flex h-12 items-center gap-1 rounded-xl px-2 text-sm text-muted hover:bg-surface-2" title="離開這頁（紀錄會保留，回來可繼續）">
            <ChevronLeft size={22} />
            離開
          </Link>
          <div className="shrink-0">
            <p className="text-xs text-muted">{live ? "入豆後經過" : "已下豆"}</p>
            <p className="font-mono text-5xl font-semibold leading-none tabular-nums" aria-live="off">
              {fmtSec(elapsed)}
            </p>
          </div>
          <div className="min-w-0 flex-1 px-2">
            {live ? (
              <>
                <p className="text-sm text-muted">
                  下一個紀錄點 <b className="text-fg">{fmtSec(nextMark)}</b>・還有 {nextMark - elapsed} 秒
                </p>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${progress}%` }} />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">總時間 {fmtSec(elapsed)}</p>
            )}
          </div>
          <button type="button" onClick={() => update((x) => ({ ...x, beep: !x.beep }))} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-2" aria-label={d.beep ? "關閉提示音" : "開啟提示音"} title={d.beep ? "提示音開" : "提示音關"}>
            {d.beep ? <Volume2 size={22} /> : <VolumeX size={22} />}
          </button>
          <button
            type="button"
            onClick={() => window.confirm("放棄這次紀錄？已記的資料會刪除，無法復原。") && onDiscard()}
            className="flex h-12 shrink-0 items-center rounded-xl px-3 text-sm text-danger hover:bg-danger-soft"
          >
            放棄
          </button>
        </div>

        {/* 火力／風門／鍋速、事件（下豆後改為摘要） */}
        <div data-area="ctl" className="grid content-start gap-3">
          <div className="grid grid-cols-3 gap-2" title={editing == null && live ? "調整會直接記在目前的紀錄點，之後沿用" : undefined}>
            {CTL.map(([k, label]) => (
              <div key={k} className="rounded-xl border border-border bg-surface p-2">
                <div className="flex items-baseline justify-between px-1">
                  <span className="text-sm text-muted">{label}</span>
                  <span className="font-mono text-3xl font-semibold tabular-nums">{show(curCtl[k])}</span>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  <button type="button" onClick={() => changeCtl(k, -1)} className="flex h-12 items-center justify-center rounded-lg bg-surface-2 active:bg-primary-soft" aria-label={`${label}減少`}>
                    <Minus size={26} />
                  </button>
                  <button type="button" onClick={() => changeCtl(k, 1)} className="flex h-12 items-center justify-center rounded-lg bg-surface-2 active:bg-primary-soft" aria-label={`${label}增加`}>
                    <Plus size={26} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {live && editing == null && (
            <div className="grid grid-cols-5 gap-2">
              {(Object.keys(EVENT_LABEL) as EventKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => markEvent(k)}
                  className={cn("flex h-14 flex-col items-center justify-center rounded-xl border text-base font-medium leading-tight", k === "DROP" ? "border-danger bg-danger text-primary-fg" : d.events[k] ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface")}
                >
                  {EVENT_LABEL[k]}
                  {d.events[k] && <span className="text-xs font-normal">{fmtSec(d.events[k]!.t)}</span>}
                </button>
              ))}
            </div>
          )}
          {!live && <DropSummary d={d} onContinue={() => update((x) => ({ ...x, droppedAt: null, events: { ...x.events, DROP: undefined } }))} onSubmit={() => router.push("/roasting/new/?live=1")} />}
        </div>

        {/* 豆溫輸入：一般數字鍵盤排列 */}
        <div data-area="pad" className="flex min-h-0 flex-col gap-2 rounded-2xl border border-border bg-surface p-3">
          <div className="flex h-8 shrink-0 items-center justify-between gap-2">
            <p className="text-sm text-muted">
              {editing != null ? (
                <>
                  修改 <b className="text-fg">{fmtSec(editing)}</b> 的紀錄
                </>
              ) : (
                <>
                  豆溫（記在 <b className="text-fg">{fmtSec(mark)}</b>）
                </>
              )}
            </p>
            {editing != null && (
              <span className="flex gap-1">
                {d.rows[editing] && (
                  <button type="button" className="rounded-lg px-2 py-1 text-sm text-danger hover:bg-danger-soft" onClick={() => { removeRow(editing); cancelEdit(); }}>
                    刪除這列
                  </button>
                )}
                <button type="button" onClick={cancelEdit} className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-surface-2">
                  取消修改
                </button>
              </span>
            )}
          </div>
          <div className="flex h-16 shrink-0 items-center justify-end rounded-xl border border-border-strong bg-surface-2 px-5 font-mono text-5xl tabular-nums" aria-label="輸入的豆溫">
            {entry || <span className="text-muted">{show(d.rows[mark]?.bt ?? null)}</span>}
            <span className="ml-2 text-2xl text-muted">°C</span>
          </div>
          <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-3 gap-2">
            {KEYS.map((k) => (
              <button key={k} type="button" onClick={() => key(k)} className={cn("flex min-h-14 items-center justify-center rounded-xl border border-border text-3xl font-medium active:bg-primary-soft", k === "del" || k === "." ? "bg-surface-2" : "bg-surface")} aria-label={k === "del" ? "刪除一位" : k}>
                {k === "del" ? <Delete size={28} /> : k}
              </button>
            ))}
          </div>
          <button type="button" onClick={record} className="h-16 shrink-0 rounded-2xl bg-primary text-2xl font-semibold text-primary-fg active:opacity-80">
            {editing != null ? `儲存 ${fmtSec(editing)}` : `記錄 ${fmtSec(mark)}`}
          </button>
        </div>

        {/* 曲線與紀錄表（表格在框內自己捲動） */}
        <div data-area="log" className="flex min-h-0 flex-col gap-3">
          <div className="shrink-0 rounded-2xl border border-border bg-surface p-2">
            <MiniChart d={d} elapsed={elapsed} />
          </div>
          <div className="max-h-[60vh] min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-surface [@media(min-width:700px)_and_(min-height:560px)]:max-h-none" title="點任一列可修改該時間點的紀錄">
            <table className="w-full text-center text-lg tabular-nums">
              <thead className="sticky top-0 bg-surface-2 text-sm text-muted">
                <tr>
                  <th className="py-2">時間</th>
                  <th>豆溫</th>
                  <th>RoR</th>
                  <th>火力</th>
                  <th>風門</th>
                  <th>鍋速</th>
                </tr>
              </thead>
              <tbody>
                {marks.map((t) => {
                  const r = d.rows[t];
                  const ev = eventsAt(t);
                  const ror = rorAt(rows, t);
                  return (
                    <tr key={t} onClick={() => startEdit(t)} className={cn("cursor-pointer border-t border-border", t === mark && "bg-primary-soft/60", t === editing && "outline-2 outline-primary")}>
                      <td className="py-2 font-mono">
                        {fmtSec(t)}
                        {ev.length > 0 && <div className="text-xs text-primary">{ev.join("、")}</div>}
                      </td>
                      <td className="font-semibold">{show(r?.bt)}</td>
                      <td className="text-sm text-muted">{ror == null ? "—" : ror.toFixed(1)}</td>
                      <td>{show(r?.heat)}</td>
                      <td>{show(r?.air)}</td>
                      <td>{show(r?.drum)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function DropSummary({ d, onContinue, onSubmit }: { d: LiveDraft; onContinue: () => void; onSubmit: () => void }) {
  const total = d.droppedAt ?? 0;
  const fc = d.events.FC_START?.t;
  const dev = fc != null ? total - fc : null;
  return (
    <Card className="border-primary p-3">
      <p className="text-lg font-semibold">已下豆</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted">總時間</dt>
          <dd className="text-lg font-medium">{fmtSec(total)}</dd>
        </div>
        <div>
          <dt className="text-muted">轉黃</dt>
          <dd className="text-lg font-medium">{d.events.DRY_END ? fmtSec(d.events.DRY_END.t) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">一爆</dt>
          <dd className="text-lg font-medium">{fc != null ? fmtSec(fc) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">發展時間（DTR）</dt>
          <dd className="text-lg font-medium">{dev != null && total ? `${fmtSec(dev)}（${((dev / total) * 100).toFixed(1)}%）` : "—"}</dd>
        </div>
      </dl>
      {!d.greenLotId && <Notice tone="warning">尚未選擇生豆批次，下一步的表單裡可以選生豆，或沒有生豆採購時直接選咖啡豆。</Notice>}
      <div className="mt-4 grid gap-2 sm:grid-cols-[2fr_1fr]">
        <button type="button" onClick={onSubmit} className="h-16 rounded-2xl bg-primary text-xl font-semibold text-primary-fg active:opacity-80">
          下一步：填出爐重量並過帳
        </button>
        <button type="button" onClick={onContinue} className="h-16 rounded-2xl border border-border-strong text-base">
          取消下豆，繼續計時
        </button>
      </div>
    </Card>
  );
}

/** 簡易曲線：豆溫（實線）與 RoR（虛線） */
function MiniChart({ d, elapsed }: { d: LiveDraft; elapsed: number }) {
  const rows = sortedRows(d).filter((r) => r.bt != null);
  const W = 600;
  const H = 220;
  const pad = { l: 36, r: 34, t: 10, b: 22 };
  const maxT = Math.max(600, Math.ceil((elapsed + 60) / 120) * 120);
  const bts = rows.map((r) => r.bt as number);
  const minBt = Math.min(80, ...bts);
  const maxBt = Math.max(230, ...bts);
  const x = (t: number) => pad.l + (t / maxT) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - minBt) / (maxBt - minBt)) * (H - pad.t - pad.b);
  const rors = rows.map((r) => ({ t: r.t, v: rorAt(rows, r.t) })).filter((p) => p.v != null) as Array<{ t: number; v: number }>;
  const maxRor = Math.max(20, ...rors.map((p) => p.v));
  const yr = (v: number) => pad.t + (1 - Math.max(0, v) / maxRor) * (H - pad.t - pad.b);
  const path = (pts: Array<[number, number]>) => pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
  const ticks: number[] = [];
  for (let t = 0; t <= maxT; t += maxT > 900 ? 120 : 60) ticks.push(t);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="max-h-[30dvh] w-full" role="img" aria-label="豆溫與 RoR 曲線">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={pad.t} y2={H - pad.b} stroke="var(--color-border, #ccc)" strokeWidth="1" />
          <text x={x(t)} y={H - 6} fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.6">
            {fmtSec(t)}
          </text>
        </g>
      ))}
      {[minBt, (minBt + maxBt) / 2, maxBt].map((v) => (
        <text key={v} x={pad.l - 4} y={y(v) + 4} fontSize="11" textAnchor="end" fill="currentColor" opacity="0.6">
          {Math.round(v)}
        </text>
      ))}
      <text x={W - pad.r + 4} y={pad.t + 10} fontSize="11" fill="currentColor" opacity="0.6">
        RoR
      </text>
      {Object.entries(d.events).map(([k, e]) =>
        e ? <line key={k} x1={x(e.t)} x2={x(e.t)} y1={pad.t} y2={H - pad.b} stroke="var(--color-primary, #6b4a33)" strokeDasharray="3 3" strokeWidth="1" opacity="0.6" /> : null,
      )}
      {d.droppedAt == null && <line x1={x(elapsed)} x2={x(elapsed)} y1={pad.t} y2={H - pad.b} stroke="var(--color-primary, #6b4a33)" strokeWidth="2" />}
      {rors.length > 1 && <path d={path(rors.map((p) => [x(p.t), yr(p.v)]))} fill="none" stroke="var(--color-info, #3b82f6)" strokeWidth="2" strokeDasharray="5 4" />}
      {rows.length > 1 && <path d={path(rows.map((r) => [x(r.t), y(r.bt as number)]))} fill="none" stroke="var(--color-danger, #c2410c)" strokeWidth="2.5" />}
      {rows.map((r) => (
        <circle key={r.t} cx={x(r.t)} cy={y(r.bt as number)} r="3" fill="var(--color-danger, #c2410c)" />
      ))}
    </svg>
  );
}
