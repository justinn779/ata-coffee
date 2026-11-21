"use client";

import Link from "next/link";
import { fmtNum, fmtPct } from "@/lib/decimal";
import { fmtDbDate, todayTaipei } from "@/lib/time";
import { RESEARCH_STATUS } from "@/lib/labels";
import { opAction } from "@/lib/api";
import { useCol, useDocument, type Row } from "@/lib/data";
import { Guard, useQS, useRoastBatchOptions } from "@/lib/page";
import { ActionDialog } from "@/components/action-dialog";
import { Chart } from "@/components/chart";
import { StatusBadge } from "@/components/status";
import { A, Badge, Card, CardBody, CardHeader, KV, Notice, PageHeader, SimpleTable } from "@/components/ui";
import { ProjectForm } from "../project-form";

type Opt = { value: string; label: string };
/** 實驗版本欄位（新增與修改共用） */
const expFields = (roastOpts: Opt[], e?: Row) => [
  { name: "label", label: "實驗名稱", required: true, defaultValue: e?.label },
  { name: "experimentDate", label: "實驗日期", type: "date" as const, required: true, defaultValue: e?.experimentDate ?? todayTaipei() },
  { name: "isBaseline", label: "是否為基準組", type: "select" as const, options: [{ value: "false", label: "否" }, { value: "true", label: "是（基準組）" }], defaultValue: e?.isBaseline ? "true" : "false" },
  { name: "variableValues", label: "變因數值（每行 名稱:值）", type: "textarea" as const, hint: "例：DTR:18%", defaultValue: e ? Object.entries((e.variableValues as Record<string, string>) ?? {}).map(([k, v]) => `${k}:${v}`).join("\n") : undefined },
  { name: "roastBatchId", label: "關聯烘焙批次（含其杯測、沖煮）", type: "select" as const, options: [{ value: "", label: "（無）" }, ...roastOpts], defaultValue: e?.roastBatchId ?? "" },
  { name: "observation", label: "主觀觀察", type: "textarea" as const, defaultValue: e?.observation ?? undefined },
];

function stats(xs: number[]) {
  if (!xs.length) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1)) : null;
  return { n: xs.length, mean, sd };
}

export default function ResearchDetail() {
  const id = useQS("id");
  const edit = useQS("edit");
  const p = useDocument("researchProjects", id);
  const roasts = useCol("roastBatches");
  const cups = useCol("cuppingSessions");
  const brews = useCol("brewSessions");
  const roastOpts = useRoastBatchOptions();
  return (
    <Guard loading={p.loading} error={p.error} missing={!p.data}>
      {() => {
        const x = p.data!;
        if (edit)
          return (
            <>
              <PageHeader title={`編輯：${x.name}`} back={{ href: `/research/view/?id=${x.id}`, label: x.name }} />
              <ProjectForm initial={x} />
            </>
          );
        const exps = ((x.experiments as Row[]) ?? []).sort((a, b) => a.version - b.version);
        const rows = exps.map((e) => {
          const rb = roasts.data.find((r) => r.id === e.roastBatchId);
          return { e, rb, cup: stats(cups.data.filter((c) => c.roastBatchId === e.roastBatchId && c.totalScore != null).map((c) => Number(c.totalScore))), brew: stats(brews.data.filter((b) => b.roastBatchId === e.roastBatchId && b.rating != null).map((b) => Number(b.rating))) };
        });
        const smallN = rows.some((r) => (r.cup?.n ?? 0) < 3);
        return (
          <>
            <PageHeader
              title={`${x.code}｜${x.name}`}
              description={<StatusBadge map={RESEARCH_STATUS} value={x.status} />}
              back={{ href: "/research/", label: "研究專案" }}
              actions={
                <>
                  <Link href={`/research/view/?id=${x.id}&edit=1`} className="inline-flex h-10 items-center rounded-lg border border-border-strong px-4 text-sm">
                    編輯專案
                  </Link>
                  <ActionDialog
                    label="＋ 新增實驗版本"
                    title="新增實驗版本"
                    payload={{ projectId: x.id }}
                    fields={expFields(roastOpts)}
                    action={opAction("research.addExperiment")}
                  />
                  <ActionDialog label="刪除專案" variant="danger" title={`刪除研究專案「${x.name}」？`} description="專案與其所有實驗版本將一併刪除；關聯的烘焙、杯測、沖煮紀錄不受影響。刪除後無法復原（操作紀錄會保留）。" confirmLabel="確認刪除" payload={{ id: x.id }} action={opAction("research.delete")} redirectTo="/research/" />
                </>
              }
            />
            <div className="grid gap-6">
              <Card>
                <CardHeader title="研究設計" />
                <CardBody>
                  <KV cols={2} items={[["假設", x.hypothesis], ["研究目標", x.objective], ["控制變因", x.controlledVariables], ["實驗變因", x.independentVariables], ["開始日期", fmtDbDate(x.startDate)]]} />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="統計結果（客觀資料）" description="由關聯批次之杯測平均分與手沖評價彙總；n 為樣本數、SD 為樣本標準差" />
                <CardBody className="space-y-4">
                  {smallN && rows.length > 0 && <Notice tone="warning">部分實驗樣本數少於 3，差異不足以推論參數造成風味變化，請持續累積比較資料。</Notice>}
                  {rows.length > 0 && (
                    <Chart
                      height={260}
                      ariaLabel="各實驗版本平均分比較"
                      option={{ tooltip: { trigger: "axis" }, xAxis: { type: "category", data: rows.map((r) => `v${r.e.version}${r.e.isBaseline ? "（基準）" : ""}`) }, yAxis: { type: "value", name: "平均分", scale: true }, series: [{ name: "杯測平均分", type: "bar", data: rows.map((r) => (r.cup ? Number(r.cup.mean.toFixed(2)) : null)) }, { name: "手沖平均評價", type: "bar", data: rows.map((r) => (r.brew ? Number(r.brew.mean.toFixed(2)) : null)) }] }}
                    />
                  )}
                  <SimpleTable
                    head={["版本", "名稱", "變因", "烘焙批次", "DTR", "杯測 n / 平均 / SD", "手沖 n / 平均", ""]}
                    rows={rows.map(({ e, rb, cup, brew }) => [
                      <span key="v">v{e.version} {e.isBaseline && <Badge tone="primary">基準組</Badge>}</span>,
                      e.label,
                      Object.entries((e.variableValues as Record<string, string>) ?? {}).map(([k, v]) => `${k}=${v}`).join("；") || "—",
                      rb ? <A key="r" href={`/roasting/view/?id=${rb.id}`}>{rb.batchNo}</A> : "—",
                      rb ? fmtPct(rb.dtrPercent) : "—",
                      cup ? `${cup.n} / ${fmtNum(cup.mean, 2)} / ${cup.sd == null ? "—" : fmtNum(cup.sd, 2)}` : "無資料",
                      brew ? `${brew.n} / ${fmtNum(brew.mean, 2)}` : "無資料",
                      <span key="a" className="flex flex-wrap gap-1">
                        {!e.isBaseline && <ActionDialog label="設為基準" size="sm" variant="ghost" title="設為基準組？" payload={{ projectId: x.id, expId: e.id }} action={opAction("research.setBaseline")} />}
                        <ActionDialog label="修改" size="sm" variant="ghost" title={`修改實驗 v${e.version}`} payload={{ projectId: x.id, expId: e.id }} fields={expFields(roastOpts, e)} action={opAction("research.updateExperiment")} />
                        <ActionDialog label="刪除" size="sm" variant="ghost" title={`刪除實驗 v${e.version}「${e.label}」？`} description="只刪除此實驗版本，關聯的烘焙批次與杯測、沖煮紀錄不受影響。" confirmLabel="確認刪除" payload={{ projectId: x.id, expId: e.id }} action={opAction("research.deleteExperiment")} />
                      </span>,
                    ])}
                    empty="尚無實驗"
                  />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="主觀觀察" description="感官描述，與上方統計分開呈現" />
                <SimpleTable head={["版本", "日期", "觀察"]} rows={exps.map((e) => [`v${e.version}`, fmtDbDate(e.experimentDate), <span key="o" className="whitespace-pre-line">{e.observation ?? "—"}</span>])} empty="尚無" />
              </Card>
              <Card>
                <CardHeader title="結果與結論" />
                <CardBody>
                  <KV cols={3} items={[["結果", x.result], ["結論", x.conclusion], ["下次改善方向", x.nextSteps]]} />
                </CardBody>
              </Card>
            </div>
          </>
        );
      }}
    </Guard>
  );
}
