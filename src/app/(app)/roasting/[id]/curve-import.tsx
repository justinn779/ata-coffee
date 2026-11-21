"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { toast } from "@/components/toast";
import { importCurve, previewCurve, type CurvePreview } from "../actions";

const KEYS = [
  ["time", "時間（必填）"],
  ["bt", "豆溫 BT"],
  ["et", "環境溫 ET"],
  ["ror", "RoR"],
  ["heat", "火力"],
  ["airflow", "風門"],
  ["drum", "轉速"],
] as const;

/**
 * 曲線匯入：選檔 → 伺服器驗證與預覽（可調整欄位對應） → 確認匯入。
 * 支援通用 CSV（欄位對應）與 Artisan .alog；其他格式請先匯出 CSV。
 */
export function CurveImport({ roastBatchId }: { roastBatchId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<CurvePreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const build = () => {
    const fd = new FormData(formRef.current!);
    fd.set("roastBatchId", roastBatchId);
    if (Object.keys(mapping).length) fd.set("mapping", JSON.stringify(Object.fromEntries(Object.entries(mapping).filter(([, v]) => v))));
    return fd;
  };
  const doPreview = () =>
    start(async () => {
      const p = await previewCurve(build());
      setPreview(p);
      if (p.mapping && !Object.keys(mapping).length) setMapping(p.mapping as Record<string, string>);
    });
  const doImport = () =>
    start(async () => {
      const r = await importCurve(build());
      if (!r.ok) {
        toast([r.error, ...(r.errors ?? [])].join("\n"), "error");
        return;
      }
      toast("曲線已匯入並保存原始檔");
      setPreview(null);
      setMapping({});
      formRef.current?.reset();
      router.refresh();
    });

  return (
    <form ref={formRef} className="space-y-4" onSubmit={(e) => e.preventDefault()}>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">曲線檔（.csv / .txt / Artisan .alog，上限 5MB）</span>
          <input
            name="file"
            type="file"
            accept=".csv,.txt,.alog"
            required
            onChange={() => {
              setPreview(null);
              setMapping({});
            }}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">溫度單位</span>
          <select name="unit" className="h-10 rounded-lg border border-border bg-bg px-2 text-sm">
            <option value="C">°C</option>
            <option value="F">°F（轉換為 °C）</option>
          </select>
        </label>
        <div className="flex items-end">
          <Button type="button" variant="outline" onClick={doPreview} disabled={pending}>
            {pending ? "處理中…" : "驗證並預覽"}
          </Button>
        </div>
      </div>

      {preview?.headers && preview.headers.length > 0 && (
        <fieldset className="rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-medium text-muted">欄位對應（CSV）</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {KEYS.map(([k, label]) => (
              <label key={k} className="text-xs">
                <span className="text-muted">{label}</span>
                <select value={mapping[k] ?? ""} onChange={(e) => setMapping({ ...mapping, [k]: e.target.value })} className="mt-0.5 h-9 w-full rounded-lg border border-border bg-bg px-2 text-sm">
                  <option value="">（不匯入）</option>
                  {preview.headers!.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={doPreview}>
            以此對應重新驗證
          </Button>
        </fieldset>
      )}

      {preview && !preview.ok && (
        <div role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          <p className="font-medium">{preview.error}</p>
          {preview.errors && (
            <ul className="mt-1 list-disc pl-5">
              {preview.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {preview?.ok && (
        <div className="space-y-3 rounded-lg bg-sage-soft p-4 text-sm">
          <p>
            ✓ 格式：{preview.format === "ARTISAN_ALOG" ? "Artisan .alog" : "CSV"}，共 <b>{preview.pointCount}</b> 個資料點
            {preview.rorComputed && "；RoR 將由 BT 計算（30 秒視窗）"}
            {preview.events?.length ? `；偵測到事件：${preview.events.map((e) => e.type).join("、")}` : ""}
          </p>
          {preview.warnings?.map((w) => (
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
                {preview.sample?.map((p) => (
                  <tr key={p.timeSec}>
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
          {preview.events && preview.events.length > 0 && (
            <label className="flex items-center gap-2">
              <input type="checkbox" name="importEvents" defaultChecked className="accent-[var(--primary)]" /> 同時匯入事件標記
            </label>
          )}
          <Button type="button" onClick={doImport} disabled={pending || preview.duplicate}>
            確認匯入
          </Button>
        </div>
      )}
    </form>
  );
}
