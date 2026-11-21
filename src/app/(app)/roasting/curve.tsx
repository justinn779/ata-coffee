"use client";

import { useRef, useState } from "react";
import { ref, uploadBytes } from "firebase/storage";
import { fb } from "@/lib/firebase";
import { callOp } from "@/lib/api";
import { useCol, useCurvePoints, type Row } from "@/lib/data";
import { ROAST_EVENT } from "@/lib/labels";
import { Chart } from "@/components/chart";
import { Button, EmptyState } from "@/components/ui";
import { toast } from "@/components/toast";

/** 曲線圖：BT / ET / RoR 分開（圖例切換），單批時標示事件 */
export function CurveChart({ batches, labels, showEt = true, height = 380 }: { batches: Row[]; labels?: Record<string, string>; showEt?: boolean; height?: number }) {
  const ids = batches.map((b) => b.id);
  const curves = useCol(ids.length ? "roastCurves" : null, [["isActive", true]]);
  const active = curves.data.filter((c) => ids.includes(c.roastBatchId));
  const pts = useCurvePoints(active.map((c) => c.id));
  if (curves.loading) return <p className="py-10 text-center text-sm text-muted">載入曲線…</p>;
  if (!active.length) return <EmptyState title="尚無曲線資料" description="可匯入 CSV 或 Artisan .alog 檔。系統不會以不存在的資料繪製曲線。" />;
  const multi = batches.length > 1;
  const series: Record<string, unknown>[] = [];
  for (const c of active) {
    const p = pts[c.id] ?? [];
    const b = batches.find((x) => x.id === c.roastBatchId)!;
    const name = labels?.[b.id] ?? b.batchNo;
    const m = (t: unknown) => Math.round((Number(t) / 60) * 1000) / 1000;
    if (p.some((x) => x.bt != null))
      series.push({
        name: multi ? `${name} BT` : "BT 豆溫",
        type: "line",
        showSymbol: false,
        data: p.filter((x) => x.bt != null).map((x) => [m(x.t), x.bt]),
        markLine: !multi
          ? { symbol: "none", label: { formatter: "{b}", position: "insideEndTop", fontSize: 10 }, lineStyle: { type: "dashed", color: "var(--muted)" }, data: ((b.events as Row[]) ?? []).filter((e) => ["DRY_END", "FC_START", "FC_END", "DROP", "TURNING_POINT"].includes(e.type)).map((e) => ({ name: ROAST_EVENT[e.type], xAxis: m(e.timeSec) })).concat([b.dryEndSec != null ? { name: "轉黃點", xAxis: m(b.dryEndSec) } : null, b.firstCrackStartSec != null ? { name: "一爆", xAxis: m(b.firstCrackStartSec) } : null].filter(Boolean) as Array<{ name: string; xAxis: number }>) }
          : undefined,
      });
    if (showEt && !multi && p.some((x) => x.et != null)) series.push({ name: "ET 環境溫", type: "line", showSymbol: false, data: p.filter((x) => x.et != null).map((x) => [m(x.t), x.et]) });
    if (p.some((x) => x.ror != null)) series.push({ name: multi ? `${name} RoR` : `RoR${c.rorComputed ? "（由 BT 計算）" : ""}`, type: "line", yAxisIndex: 1, showSymbol: false, lineStyle: { width: 1 }, data: p.filter((x) => x.ror != null).map((x) => [m(x.t), x.ror]) });
  }
  return (
    <Chart
      height={height}
      ariaLabel="烘焙曲線"
      option={{
        tooltip: { trigger: "axis" },
        legend: { type: "scroll", top: 0 },
        grid: { top: 48, left: 52, right: 52, bottom: 56 },
        dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 8 }],
        xAxis: { type: "value", name: "時間（分）", nameLocation: "middle", nameGap: 26, min: 0 },
        yAxis: [
          { type: "value", name: "溫度 °C", scale: true },
          { type: "value", name: "RoR °C/分", scale: true, splitLine: { show: false } },
        ],
        series,
      }}
    />
  );
}

const KEYS = [
  ["time", "時間（必填）"],
  ["bt", "豆溫 BT"],
  ["et", "環境溫 ET"],
  ["ror", "RoR"],
  ["heat", "火力"],
  ["airflow", "風門"],
  ["drum", "轉速"],
] as const;

interface Preview {
  format: string;
  headers: string[];
  mapping: Record<string, string>;
  pointCount: number;
  sample: Array<Record<string, number | null>>;
  events: Array<{ type: string }>;
  rorComputed: boolean;
  warnings: string[];
  duplicate: boolean;
}

/** 曲線匯入：上傳原始檔到 Cloud Storage → Functions 驗證預覽（可調欄位對應）→ 確認匯入 */
export function CurveImport({ roastBatchId }: { roastBatchId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploaded, setUploaded] = useState<{ path: string; name: string } | null>(null);
  const [unit, setUnit] = useState<"C" | "F">("C");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<{ msg: string; errors?: string[] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [events, setEvents] = useState(true);
  const [pending, setPending] = useState(false);

  const upload = async (): Promise<{ path: string; name: string } | null> => {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      setError({ msg: "請選擇檔案" });
      return null;
    }
    const ext = f.name.toLowerCase().split(".").pop();
    if (!["csv", "txt", "alog"].includes(ext ?? "")) {
      setError({ msg: "僅支援 .csv、.txt、.alog" });
      return null;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError({ msg: "檔案過大（上限 5MB）" });
      return null;
    }
    const uid = fb().auth.currentUser!.uid;
    const path = `uploads/${uid}/${crypto.randomUUID()}.${ext}`;
    await uploadBytes(ref(fb().storage, path), f, { contentType: ext === "csv" ? "text/csv" : "text/plain" });
    const u = { path, name: f.name };
    setUploaded(u);
    return u;
  };

  const doPreview = async (m?: Record<string, string>) => {
    setPending(true);
    setError(null);
    try {
      const u = uploaded ?? (await upload());
      if (!u) return;
      const r = await callOp<Preview>("curve.preview", { storagePath: u.path, fileName: u.name, unit, roastBatchId, mapping: m && Object.keys(m).length ? m : null });
      if (!r.ok) {
        setPreview(null);
        setError({ msg: r.error });
        return;
      }
      const p = r.data as unknown as Preview;
      setPreview(p);
      if (!m) setMapping(p.mapping ?? {});
    } catch (e) {
      setError({ msg: (e as Error).message });
    } finally {
      setPending(false);
    }
  };

  const doImport = async () => {
    if (!uploaded) return;
    setPending(true);
    const r = await callOp("curve.import", { storagePath: uploaded.path, fileName: uploaded.name, unit, roastBatchId, mapping: Object.keys(mapping).length ? mapping : null, importEvents: events });
    setPending(false);
    if (!r.ok) return toast(r.error, "error");
    toast("曲線已匯入並保存原始檔");
    setPreview(null);
    setUploaded(null);
    setMapping({});
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">曲線檔（.csv / .txt / Artisan .alog，上限 5MB）</span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.alog"
            onChange={() => {
              setUploaded(null);
              setPreview(null);
              setMapping({});
              setError(null);
            }}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">溫度單位</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value as "C" | "F")} className="h-10 rounded-lg border border-border bg-bg px-2 text-sm">
            <option value="C">°C</option>
            <option value="F">°F（轉換為 °C）</option>
          </select>
        </label>
        <div className="flex items-end">
          <Button type="button" variant="outline" onClick={() => doPreview()} disabled={pending}>
            {pending ? "處理中…" : "驗證並預覽"}
          </Button>
        </div>
      </div>
      {preview && preview.headers.length > 0 && (
        <fieldset className="rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-medium text-muted">欄位對應（CSV）</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {KEYS.map(([k, label]) => (
              <label key={k} className="text-xs">
                <span className="text-muted">{label}</span>
                <select value={mapping[k] ?? ""} onChange={(e) => setMapping({ ...mapping, [k]: e.target.value })} className="mt-0.5 h-9 w-full rounded-lg border border-border bg-bg px-2 text-sm">
                  <option value="">（不匯入）</option>
                  {preview.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => doPreview(Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)))}>
            以此對應重新驗證
          </Button>
        </fieldset>
      )}
      {error && (
        <div role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm whitespace-pre-line text-danger">
          {error.msg}
        </div>
      )}
      {preview && (
        <div className="space-y-3 rounded-lg bg-sage-soft p-4 text-sm">
          <p>
            ✓ 格式：{preview.format === "ARTISAN_ALOG" ? "Artisan .alog" : "CSV"}，共 <b>{preview.pointCount}</b> 個資料點{preview.rorComputed && "；RoR 將由 BT 計算（30 秒視窗）"}
            {preview.events.length ? `；偵測到事件：${preview.events.map((e) => e.type).join("、")}` : ""}
          </p>
          {preview.warnings.map((w) => (
            <p key={w} className="text-warning">
              ⚠ {w}
            </p>
          ))}
          {preview.duplicate && <p className="font-medium text-danger">此檔案已匯入過本批次，再次匯入將被拒絕。</p>}
          <div className="overflow-x-auto">
            <table className="num w-full text-xs">
              <thead>
                <tr className="text-left text-muted">
                  <th className="pr-3">秒</th>
                  <th className="pr-3">BT</th>
                  <th className="pr-3">ET</th>
                  <th className="pr-3">RoR</th>
                  <th>火力</th>
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((p) => (
                  <tr key={String(p.timeSec)}>
                    <td className="pr-3">{p.timeSec}</td>
                    <td className="pr-3">{p.btC ?? "—"}</td>
                    <td className="pr-3">{p.etC ?? "—"}</td>
                    <td className="pr-3">{p.rorC ?? "—"}</td>
                    <td>{p.heat ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.events.length > 0 && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={events} onChange={(e) => setEvents(e.target.checked)} className="accent-[var(--primary)]" /> 同時匯入事件標記
            </label>
          )}
          <Button type="button" onClick={doImport} disabled={pending || preview.duplicate}>
            確認匯入
          </Button>
        </div>
      )}
    </div>
  );
}
