import { prisma } from "@/lib/db";
import { fmtNum } from "@/lib/decimal";
import { fmtDate, fmtSec } from "@/lib/time";
import { Chart } from "@/components/chart";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, SimpleTable } from "@/components/ui";

export const metadata = { title: "手沖比較" };

export default async function BrewCompare({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const raw = (await searchParams).ids;
  const ids = (Array.isArray(raw) ? raw : (raw ?? "").split(",")).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 8);
  const all = await prisma.brewSession.findMany({ orderBy: { brewedAt: "desc" }, take: 150, include: { roastBatch: { include: { greenLot: { include: { coffee: true } } } }, grinder: true, dripper: true, pourSteps: { orderBy: { stepNo: "asc" } } } });
  const sel = all.filter((s) => ids.includes(s.id)).sort((a, b) => a.restDays - b.restDays);
  const L = (s: (typeof sel)[number]) => `${fmtDate(s.brewedAt)}（${s.restDays}天）`;
  return (
    <>
      <PageHeader title="手沖比較" description="比較兩次以上沖煮；同款豆可觀察不同烘後天數的差異（觀察資料，非因果結論）" back={{ href: "/brewing", label: "手沖實驗室" }} />
      <Card className="mb-6">
        <CardHeader title="選擇沖煮紀錄" />
        <CardBody>
          <form className="space-y-3">
            <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {all.map((s) => (
                <label key={s.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2">
                  <input type="checkbox" name="ids" value={s.id} defaultChecked={ids.includes(s.id)} className="accent-[var(--primary)]" />
                  {s.roastBatch.greenLot.coffee.nameZh} · {fmtDate(s.brewedAt)}（{s.restDays} 天）
                </label>
              ))}
            </div>
            <button className="h-9 rounded-lg bg-primary px-4 text-sm text-primary-fg">比較</button>
          </form>
        </CardBody>
      </Card>
      {sel.length < 2 ? (
        <EmptyState title="請選擇至少兩筆沖煮紀錄" />
      ) : (
        <div className="grid gap-6">
          <Card>
            <CardHeader title="累積注水曲線" description="X：時間（秒）；Y：累積水量（g）" />
            <CardBody>
              <Chart
                height={300}
                ariaLabel="累積注水曲線比較"
                option={{ xAxis: { type: "value", name: "秒" }, yAxis: { type: "value", name: "累積水量 g" }, series: sel.map((s) => ({ name: L(s), type: "line", step: "end", data: [[0, 0], ...s.pourSteps.filter((p) => p.endSec != null).map((p) => [p.endSec, Number(p.cumulativeG)])] })) }}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="參數對照" />
            <SimpleTable
              head={["項目", ...sel.map(L)]}
              rows={[
                ["咖啡豆", ...sel.map((s) => s.roastBatch.greenLot.coffee.nameZh)],
                ["烘焙批次", ...sel.map((s) => s.roastBatch.batchNo)],
                ["研磨", ...sel.map((s) => `${s.grinder?.name ?? ""} ${s.grindSetting ?? ""}`.trim() || "—")],
                ["濾杯", ...sel.map((s) => s.dripper?.name ?? "—")],
                ["粉量", ...sel.map((s) => `${fmtNum(s.doseG, 1)} g`)],
                ["粉水比", ...sel.map((s) => `1:${fmtNum(s.ratio, 1)}`)],
                ["水溫", ...sel.map((s) => (s.waterTempC ? `${s.waterTempC}°C` : "—"))],
                ["總時間", ...sel.map((s) => fmtSec(s.totalTimeSec))],
                ["TDS／萃取率", ...sel.map((s) => `${fmtNum(s.tdsPercent, 2)}%／${fmtNum(s.extractionPercent, 1)}%`)],
                ["評價", ...sel.map((s) => fmtNum(s.rating, 1))],
                ["風味", ...sel.map((s) => s.flavorNotes ?? "—")],
              ]}
            />
          </Card>
        </div>
      )}
    </>
  );
}
