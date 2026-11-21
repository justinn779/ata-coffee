import { prisma } from "@/lib/db";
import { fmtNum } from "@/lib/decimal";
import { fmtDate } from "@/lib/time";
import { Chart } from "@/components/chart";
import { Card, CardBody, CardHeader, EmptyState, Notice, PageHeader, SimpleTable } from "@/components/ui";

export const metadata = { title: "杯測比較" };

export default async function CuppingCompare({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const raw = (await searchParams).ids;
  const ids = (Array.isArray(raw) ? raw : (raw ?? "").split(",")).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 8);
  const all = await prisma.cuppingSession.findMany({ orderBy: { cuppedAt: "desc" }, take: 150, include: { roastBatch: { include: { greenLot: { include: { coffee: true } } } }, template: true, scores: true } });
  const sel = all.filter((s) => ids.includes(s.id));
  const templates = new Set(sel.map((s) => s.templateId));
  const tpl = sel[0]?.template;
  const attrs = (tpl?.attributes ?? []) as Array<{ key: string; label: string }>;
  const label = (s: (typeof sel)[number]) => `${s.roastBatch.batchNo}／烘後${s.restDays}天`;
  return (
    <>
      <PageHeader title="杯測比較" description="同批次或跨批次比較；僅能比較相同評分模板的紀錄" back={{ href: "/cupping", label: "杯測實驗室" }} />
      <Card className="mb-6">
        <CardHeader title="選擇杯測紀錄（最多 8 筆）" />
        <CardBody>
          <form className="space-y-3">
            <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {all.map((s) => (
                <label key={s.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2">
                  <input type="checkbox" name="ids" value={s.id} defaultChecked={ids.includes(s.id)} className="accent-[var(--primary)]" />
                  {s.roastBatch.greenLot.coffee.nameZh} · {s.roastBatch.batchNo} · {fmtDate(s.cuppedAt)}（{s.restDays} 天）
                </label>
              ))}
            </div>
            <button className="h-9 rounded-lg bg-primary px-4 text-sm text-primary-fg">比較</button>
          </form>
        </CardBody>
      </Card>
      {sel.length === 0 ? (
        <EmptyState title="請選擇杯測紀錄" />
      ) : templates.size > 1 ? (
        <Notice tone="warning">所選紀錄使用不同評分模板，無法直接比較分數。</Notice>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="雷達圖疊圖" />
            <CardBody>
              <Chart
                height={360}
                ariaLabel="杯測雷達比較圖"
                option={{ tooltip: { trigger: "item" }, legend: { type: "scroll" }, radar: { indicator: attrs.map((a) => ({ name: a.label, max: Number(tpl!.scaleMax), min: Number(tpl!.scaleMin) })), radius: "60%" }, series: [{ type: "radar", data: sel.map((s) => ({ name: label(s), value: attrs.map((a) => Number(s.scores.find((x) => x.attributeKey === a.key)?.score ?? 0)) })) }] }}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="分數對照" />
            <SimpleTable head={["項目", ...sel.map(label)]} rows={[...attrs.map((a) => [a.label, ...sel.map((s) => fmtNum(s.scores.find((x) => x.attributeKey === a.key)?.score, 2))]), ["平均", ...sel.map((s) => fmtNum(s.totalScore, 2))]]} />
          </Card>
        </div>
      )}
    </>
  );
}
