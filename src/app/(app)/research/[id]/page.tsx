import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D, fmtNum, fmtPct } from "@/lib/decimal";
import { fmtDbDate, todayTaipei } from "@/lib/time";
import { RESEARCH_STATUS } from "@/lib/labels";
import { ActionDialog } from "@/components/action-dialog";
import { Chart } from "@/components/chart";
import { StatusBadge } from "@/components/status";
import { A, Badge, Card, CardBody, CardHeader, KV, Notice, PageHeader, SimpleTable } from "@/components/ui";
import { roastBatchOptions } from "@/server/options";
import { addExperiment, setBaseline } from "../actions";
import { ProjectForm } from "../project-form";

function stats(xs: number[]) {
  if (!xs.length) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1)) : null;
  return { n: xs.length, mean, sd, min: Math.min(...xs), max: Math.max(...xs) };
}

export default async function ResearchDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { id } = await params;
  const { edit } = await searchParams;
  const p = await prisma.researchProject.findUnique({
    where: { id },
    include: {
      experiments: {
        orderBy: { version: "asc" },
        include: { links: { include: { roastBatch: { include: { cuppingSessions: true, brewSessions: true } }, cuppingSession: true, brewSession: true } } },
      },
    },
  });
  if (!p) notFound();
  if (edit) {
    return (
      <>
        <PageHeader title={`編輯：${p.name}`} back={{ href: `/research/${p.id}`, label: p.name }} />
        <ProjectForm initial={p} />
      </>
    );
  }
  const roasts = await roastBatchOptions();
  const rows = p.experiments.map((e) => {
    const cup = [...e.links.flatMap((l) => (l.cuppingSession ? [l.cuppingSession] : [])), ...e.links.flatMap((l) => l.roastBatch?.cuppingSessions ?? [])];
    const brew = [...e.links.flatMap((l) => (l.brewSession ? [l.brewSession] : [])), ...e.links.flatMap((l) => l.roastBatch?.brewSessions ?? [])];
    const uniq = <T extends { id: string }>(a: T[]) => [...new Map(a.map((x) => [x.id, x])).values()];
    const rb = e.links.find((l) => l.roastBatch)?.roastBatch;
    return { e, rb, cup: stats(uniq(cup).filter((c) => c.totalScore != null).map((c) => Number(c.totalScore))), brew: stats(uniq(brew).filter((b) => b.rating != null).map((b) => Number(b.rating))) };
  });
  const chart = {
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: rows.map((r) => `v${r.e.version}${r.e.isBaseline ? "（基準）" : ""}`) },
    yAxis: { type: "value", name: "平均分", scale: true },
    series: [
      { name: "杯測平均分", type: "bar", data: rows.map((r) => (r.cup ? Number(r.cup.mean.toFixed(2)) : null)) },
      { name: "手沖平均評價", type: "bar", data: rows.map((r) => (r.brew ? Number(r.brew.mean.toFixed(2)) : null)) },
    ],
  };
  const smallN = rows.some((r) => (r.cup?.n ?? 0) < 3);
  return (
    <>
      <PageHeader
        title={`${p.code}｜${p.name}`}
        description={<StatusBadge map={RESEARCH_STATUS} value={p.status} />}
        back={{ href: "/research", label: "研究專案" }}
        actions={
          <>
            <a href={`?edit=1`} className="inline-flex h-10 items-center rounded-lg border border-border-strong px-4 text-sm">
              編輯專案
            </a>
            <ActionDialog
              label="＋ 新增實驗版本"
              title="新增實驗版本"
              payload={{ projectId: p.id }}
              fields={[
                { name: "label", label: "實驗名稱", required: true },
                { name: "experimentDate", label: "實驗日期", type: "date", required: true, defaultValue: todayTaipei() },
                { name: "isBaseline", label: "是否為基準組", type: "select", options: [{ value: "false", label: "否" }, { value: "true", label: "是（基準組）" }] },
                { name: "variableValues", label: "變因數值（每行 名稱:值）", type: "textarea", hint: "例：DTR:18%" },
                { name: "roastBatchId", label: "關聯烘焙批次（含其杯測、沖煮）", type: "select", options: [{ value: "", label: "（無）" }, ...roasts] },
                { name: "observation", label: "主觀觀察", type: "textarea" },
              ]}
              action={addExperiment}
            />
          </>
        }
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader title="研究設計" />
          <CardBody>
            <KV cols={2} items={[["假設", p.hypothesis], ["研究目標", p.objective], ["控制變因", p.controlledVariables], ["實驗變因", p.independentVariables], ["開始日期", fmtDbDate(p.startDate)]]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="統計結果（客觀資料）" description="由關聯批次之杯測平均分與手沖評價彙總；n 為樣本數、SD 為樣本標準差" />
          <CardBody className="space-y-4">
            {smallN && <Notice tone="warning">部分實驗樣本數少於 3，差異不足以推論參數造成風味變化，請持續累積比較資料。</Notice>}
            {rows.length > 0 && <Chart option={chart} height={260} ariaLabel="各實驗版本平均分比較" />}
            <SimpleTable
              head={["版本", "名稱", "變因", "烘焙批次", "DTR", "杯測 n / 平均 / SD", "手沖 n / 平均", ""]}
              rows={rows.map(({ e, rb, cup, brew }) => [
                <span key="v">
                  v{e.version} {e.isBaseline && <Badge tone="primary">基準組</Badge>}
                </span>,
                e.label,
                Object.entries((e.variableValues as Record<string, string>) ?? {}).map(([k, v]) => `${k}=${v}`).join("；") || "—",
                rb ? <A key="r" href={`/roasting/${rb.id}`}>{rb.batchNo}</A> : "—",
                rb ? fmtPct(rb.dtrPercent) : "—",
                cup ? `${cup.n} / ${fmtNum(cup.mean, 2)} / ${cup.sd == null ? "—" : fmtNum(D(cup.sd), 2)}` : "無資料",
                brew ? `${brew.n} / ${fmtNum(brew.mean, 2)}` : "無資料",
                e.isBaseline ? "" : <ActionDialog key="b" label="設為基準" size="sm" variant="ghost" title="設為基準組？" payload={{ id: e.id }} action={setBaseline} />,
              ])}
              empty="尚無實驗"
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="主觀觀察" description="感官描述，與上方統計分開呈現" />
          <SimpleTable head={["版本", "日期", "觀察"]} rows={p.experiments.map((e) => [`v${e.version}`, fmtDbDate(e.experimentDate), <span key="o" className="whitespace-pre-line">{e.observation ?? "—"}</span>])} empty="尚無" />
        </Card>
        <Card>
          <CardHeader title="結果與結論" />
          <CardBody>
            <KV cols={3} items={[["結果", p.result], ["結論", p.conclusion], ["下次改善方向", p.nextSteps]]} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
