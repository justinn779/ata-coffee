"use client";

import { useRouter } from "next/navigation";
import { fmtNum } from "@/lib/decimal";
import { fmtDate } from "@/lib/time";
import { useCol, type Row } from "@/lib/data";
import { useQSList } from "@/lib/page";
import { Chart } from "@/components/chart";
import { Card, CardBody, CardHeader, EmptyState, Notice, PageHeader, SimpleTable } from "@/components/ui";

export default function CuppingCompare() {
  const router = useRouter();
  const ids = useQSList("ids").slice(0, 8);
  const all = useCol("cuppingSessions", [], "cuppedAt");
  const tpls = useCol("cuppingTemplates");
  const sel = all.data.filter((s) => ids.includes(s.id));
  const tplIds = new Set(sel.map((s) => s.templateId));
  const tpl = tpls.data.find((t) => t.id === sel[0]?.templateId);
  const attrs = (tpl?.attributes ?? []) as Array<{ key: string; label: string }>;
  const L = (s: Row) => `${s.batchNo}／烘後${s.restDays}天`;
  const sc = (s: Row, k: string) => (s.scores as Array<{ attributeKey: string; score: string }>).find((q) => q.attributeKey === k)?.score;
  return (
    <>
      <PageHeader title="杯測比較" description="同批次或跨批次比較；僅能比較相同評分模板的紀錄" back={{ href: "/cupping/", label: "杯測實驗室" }} />
      <Card className="mb-6">
        <CardHeader title="選擇杯測紀錄（最多 8 筆）" />
        <CardBody>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); router.push(`/cupping/compare/?ids=${new FormData(e.currentTarget).getAll("ids").join(",")}`); }}>
            <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {all.data.map((s) => (
                <label key={s.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2">
                  <input type="checkbox" name="ids" value={s.id} defaultChecked={ids.includes(s.id)} className="accent-[var(--primary)]" />
                  {s.coffeeName} · {s.batchNo} · {fmtDate(s.cuppedAt)}（{s.restDays} 天）
                </label>
              ))}
            </div>
            <button className="h-9 rounded-lg bg-primary px-4 text-sm text-primary-fg">比較</button>
          </form>
        </CardBody>
      </Card>
      {sel.length === 0 ? (
        <EmptyState title="請選擇杯測紀錄" />
      ) : tplIds.size > 1 ? (
        <Notice tone="warning">所選紀錄使用不同評分模板，無法直接比較分數。</Notice>
      ) : tpl ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="雷達圖疊圖" />
            <CardBody>
              <Chart height={360} ariaLabel="杯測雷達比較圖" option={{ tooltip: { trigger: "item" }, legend: { type: "scroll" }, radar: { indicator: attrs.map((a) => ({ name: a.label, max: Number(tpl.scaleMax), min: Number(tpl.scaleMin) })), radius: "60%" }, series: [{ type: "radar", data: sel.map((s) => ({ name: L(s), value: attrs.map((a) => Number(sc(s, a.key) ?? 0)) })) }] }} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="分數對照" />
            <SimpleTable head={["項目", ...sel.map(L)]} rows={[...attrs.map((a) => [a.label, ...sel.map((s) => fmtNum(sc(s, a.key), 2))]), ["平均", ...sel.map((s) => fmtNum(s.totalScore, 2))]]} />
          </Card>
        </div>
      ) : null}
    </>
  );
}
