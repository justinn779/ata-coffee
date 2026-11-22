"use client";

import { fmtNum } from "@/lib/decimal";
import { fmtDate } from "@/lib/time";
import { useCol } from "@/lib/data";
import { Guard } from "@/lib/page";
import { DataTable } from "@/components/data-table";
import { Chart } from "@/components/chart";
import { Card, CardBody, CardHeader, LinkButton, PageHeader } from "@/components/ui";

export default function CuppingPage() {
  const s = useCol("cuppingSessions", [], "cuppedAt");
  const byCoffee = new Map<string, { name: string; pts: Array<[number, number]>; trend: Array<[string, number]> }>();
  for (const x of s.data) {
    if (x.totalScore == null) continue;
    const e = byCoffee.get(x.coffeeId) ?? { name: x.coffeeName as string, pts: [] as Array<[number, number]>, trend: [] as Array<[string, number]> };
    e.pts.push([x.restDays, Number(x.totalScore)]);
    e.trend.push([x.cuppedAt, Number(x.totalScore)]);
    byCoffee.set(x.coffeeId, e);
  }
  return (
    <>
      <PageHeader title="杯測" description="每次杯測對應實際烘焙批次；評分使用自訂模板（非 SCA 官方標準）" actions={<><LinkButton href="/cupping/compare/" variant="outline">比較</LinkButton><LinkButton href="/cupping/new/">＋ 新增杯測</LinkButton></>} />
      <Guard loading={s.loading} error={s.error}>
        {() => (
          <>
            {byCoffee.size > 0 && (
              <div className="mb-6 grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader title="養豆天數比較" description="X：烘後天數；Y：模板平均分（觀察資料，非因果結論）" />
                  <CardBody>
                    <Chart height={280} ariaLabel="各豆款平均分與烘後天數關係圖" option={{ tooltip: { trigger: "item" }, xAxis: { type: "value", name: "烘後天數（天）", nameLocation: "middle", nameGap: 26 }, yAxis: { type: "value", name: "平均分", scale: true }, series: [...byCoffee.values()].map((c) => ({ name: c.name, type: "line", symbolSize: 8, data: [...c.pts].sort((a, b) => a[0] - b[0]) })) }} />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="評分趨勢" description="依杯測日期" />
                  <CardBody>
                    <Chart height={280} ariaLabel="杯測平均分趨勢圖" option={{ xAxis: { type: "time", name: "杯測日期" }, yAxis: { type: "value", name: "平均分", scale: true }, series: [...byCoffee.values()].map((c) => ({ name: c.name, type: "line", symbolSize: 6, data: [...c.trend].sort((a, b) => a[0].localeCompare(b[0])) })) }} />
                  </CardBody>
                </Card>
              </div>
            )}
            <DataTable
              columns={[
                { key: "date", label: "杯測日期", sortable: true },
                { key: "coffee", label: "咖啡豆" },
                { key: "batch", label: "烘焙批次", hideOnMobile: true },
                { key: "rest", label: "烘後天數", align: "right", sortable: true },
                { key: "score", label: "平均分", align: "right", sortable: true },
                { key: "tags", label: "風味標籤", hideOnMobile: true },
                { key: "who", label: "評分者", hideOnMobile: true },
              ]}
              filters={[{ key: "coffee", label: "豆款", options: [...byCoffee.entries()].map(([value, c]) => ({ value, label: c.name })) }]}
              rows={s.data.map((x) => ({
                id: x.id,
                href: `/cupping/view/?id=${x.id}`,
                search: [x.batchNo, x.coffeeName, x.description, x.evaluator, ...(x.tags ?? [])].join(" "),
                filters: { coffee: x.coffeeId },
                sort: { date: x.cuppedAt, rest: x.restDays, score: x.totalScore == null ? null : Number(x.totalScore) },
                cells: { date: fmtDate(x.cuppedAt), coffee: x.coffeeName, batch: x.batchNo, rest: `${x.restDays} 天`, score: fmtNum(x.totalScore, 2), tags: (x.tags ?? []).join("、") || "—", who: x.evaluator ?? "—" },
              }))}
            />
          </>
        )}
      </Guard>
    </>
  );
}
