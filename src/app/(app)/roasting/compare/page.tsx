import { prisma } from "@/lib/db";
import { fmtPct } from "@/lib/decimal";
import { fmtDate, fmtSec } from "@/lib/time";
import { Chart } from "@/components/chart";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, SimpleTable } from "@/components/ui";
import { curveOption } from "../curve-chart";

export const metadata = { title: "烘焙曲線比較" };

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const raw = (await searchParams).ids;
  const ids = (Array.isArray(raw) ? raw : (raw ?? "").split(",")).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 6);
  const all = await prisma.roastBatch.findMany({ orderBy: { roastedAt: "desc" }, take: 100, include: { greenLot: { include: { coffee: true } }, _count: { select: { curves: true } } } });
  const selected = all.filter((b) => ids.includes(b.id));
  const option = selected.length ? await curveOption(ids, { labels: Object.fromEntries(selected.map((b) => [b.id, b.batchNo])), showEt: false }) : null;

  return (
    <>
      <PageHeader title="烘焙曲線比較" description="最多 6 批疊圖；時間以入豆為 0。圖例可分別切換各批 BT／RoR。" back={{ href: "/roasting", label: "烘焙中心" }} />
      <Card className="mb-6">
        <CardHeader title="選擇批次" />
        <CardBody>
          <form className="space-y-3">
            <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {all.map((b) => (
                <label key={b.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2">
                  <input type="checkbox" name="ids" value={b.id} defaultChecked={ids.includes(b.id)} disabled={!b._count.curves} className="accent-[var(--primary)]" />
                  <span className={b._count.curves ? "" : "text-muted"}>
                    {b.batchNo} · {b.greenLot.coffee.nameZh} · {fmtDate(b.roastedAt)}
                    {!b._count.curves && "（無曲線）"}
                  </span>
                </label>
              ))}
            </div>
            <button className="h-9 rounded-lg bg-primary px-4 text-sm text-primary-fg">比較</button>
          </form>
        </CardBody>
      </Card>
      {option ? (
        <>
          <Card className="mb-6">
            <CardHeader title="曲線疊圖" description="溫度 °C（左軸）／RoR °C/分（右軸）" />
            <CardBody>
              <Chart option={option} height={440} ariaLabel="烘焙曲線疊圖比較" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="數據比較" />
            <SimpleTable
              head={["批次", "咖啡豆", "日期", "失重率", "轉黃點", "一爆", "下豆", "DTR"]}
              rows={selected.map((b) => [b.batchNo, b.greenLot.coffee.nameZh, fmtDate(b.roastedAt), fmtPct(b.weightLossPercent), fmtSec(b.dryEndSec), fmtSec(b.firstCrackStartSec), fmtSec(b.dropSec), fmtPct(b.dtrPercent)])}
            />
          </Card>
        </>
      ) : (
        <EmptyState title="請勾選要比較的批次" description="只有已匯入曲線的批次可以疊圖" />
      )}
    </>
  );
}
