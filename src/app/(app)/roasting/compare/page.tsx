"use client";

import { useRouter } from "next/navigation";
import { fmtPct } from "@/lib/decimal";
import { fmtDate, fmtSec } from "@/lib/time";
import { useCol } from "@/lib/data";
import { useQSList } from "@/lib/page";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, SimpleTable } from "@/components/ui";
import { CurveChart } from "../curve";

export default function ComparePage() {
  const router = useRouter();
  const ids = useQSList("ids").slice(0, 6);
  const all = useCol("roastBatches", [], "roastedAt");
  const curves = useCol("roastCurves");
  const sel = all.data.filter((b) => ids.includes(b.id));
  const hasCurve = (id: string) => curves.data.some((c) => c.roastBatchId === id);
  return (
    <>
      <PageHeader title="烘焙曲線比較" description="最多 6 批疊圖；時間以入豆為 0。圖例可分別切換各批 BT／RoR。" back={{ href: "/roasting/", label: "烘豆紀錄" }} />
      <Card className="mb-6">
        <CardHeader title="選擇批次" />
        <CardBody>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const picked = new FormData(e.currentTarget).getAll("ids").join(",");
              router.push(`/roasting/compare/?ids=${picked}`);
            }}
          >
            <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {all.data.map((b) => (
                <label key={b.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2">
                  <input type="checkbox" name="ids" value={b.id} defaultChecked={ids.includes(b.id)} disabled={!hasCurve(b.id)} className="accent-[var(--primary)]" />
                  <span className={hasCurve(b.id) ? "" : "text-muted"}>
                    {b.batchNo} · {b.coffeeName} · {fmtDate(b.roastedAt)}
                    {!hasCurve(b.id) && "（無曲線）"}
                  </span>
                </label>
              ))}
            </div>
            <button className="h-9 rounded-lg bg-primary px-4 text-sm text-primary-fg">比較</button>
          </form>
        </CardBody>
      </Card>
      {sel.length ? (
        <>
          <Card className="mb-6">
            <CardHeader title="曲線疊圖" description="溫度 °C（左軸）／RoR °C/分（右軸）" />
            <CardBody>
              <CurveChart batches={sel} showEt={false} height={440} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="數據比較" />
            <SimpleTable head={["批次", "咖啡豆", "日期", "失重率", "轉黃點", "一爆", "下豆", "DTR"]} rows={sel.map((b) => [b.batchNo, b.coffeeName, fmtDate(b.roastedAt), fmtPct(b.weightLossPercent), fmtSec(b.dryEndSec), fmtSec(b.firstCrackStartSec), fmtSec(b.dropSec), fmtPct(b.dtrPercent)])} />
          </Card>
        </>
      ) : (
        <EmptyState title="請勾選要比較的批次" description="只有已匯入曲線的批次可以疊圖" />
      )}
    </>
  );
}
