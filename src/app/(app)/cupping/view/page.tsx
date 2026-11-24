"use client";

import { fmtNum } from "@/lib/decimal";
import { fmtDateTime } from "@/lib/time";
import { useCol, useDocument } from "@/lib/data";
import { Guard, useQS } from "@/lib/page";
import { opAction } from "@/lib/api";
import { Chart } from "@/components/chart";
import { ActionDialog } from "@/components/action-dialog";
import { A, Badge, Card, CardBody, CardHeader, KV, LinkButton, PageHeader, SimpleTable } from "@/components/ui";

export default function CuppingDetail() {
  const id = useQS("id");
  const s = useDocument("cuppingSessions", id);
  const tpl = useDocument("cuppingTemplates", s.data?.templateId);
  const sib = useCol(s.data ? "cuppingSessions" : null, [["roastBatchId", s.data?.roastBatchId]], "cuppedAt", false);
  return (
    <Guard loading={s.loading || tpl.loading} error={s.error} missing={!s.data || !tpl.data}>
      {() => {
        const x = s.data!;
        const t = tpl.data!;
        const attrs = t.attributes as Array<{ key: string; label: string }>;
        const sc = (r: typeof x, k: string) => (r.scores as Array<{ attributeKey: string; score: string }>).find((q) => q.attributeKey === k)?.score;
        return (
          <>
            <PageHeader
              title={`杯測｜${x.coffeeName}`}
              description={`${fmtDateTime(x.cuppedAt)}${x.restDays == null ? "" : ` · 烘後第 ${x.restDays} 天`} · ${t.name}`}
              back={{ href: "/cupping/", label: "杯測" }}
              actions={<><LinkButton href={`/cupping/compare/?ids=${sib.data.map((q) => q.id).join(",")}`} variant="outline">同批次比較</LinkButton><LinkButton href={`/cupping/new/?roast=${x.roastBatchId}`}>＋ 再杯測一次</LinkButton><LinkButton href={`/cupping/new/?edit=${x.id}`} variant="secondary">修改</LinkButton><ActionDialog label="刪除" variant="danger" title="刪除這筆杯測？" description={x.stockTxId !== null ? "若此杯測曾扣除熟豆庫存，將自動沖銷回庫存。刪除後無法復原（操作紀錄會保留）。" : "刪除後無法復原（操作紀錄會保留）。"} confirmLabel="確認刪除" payload={{ id: x.id }} action={opAction("cupping.delete")} redirectTo="/cupping/" /></>}
            />
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader title="風味雷達圖" description={`同一烘焙批次所有杯測（${sib.data.length} 次）；${t.scaleMin}–${t.scaleMax} 分`} />
                <CardBody>
                  <Chart height={340} ariaLabel="杯測風味雷達圖" option={{ tooltip: { trigger: "item" }, radar: { indicator: attrs.map((a) => ({ name: a.label, max: Number(t.scaleMax), min: Number(t.scaleMin) })), radius: "65%" }, series: [{ type: "radar", data: sib.data.map((q) => ({ name: `烘後 ${q.restDays} 天${q.id === x.id ? "（本次）" : ""}`, value: attrs.map((a) => Number(sc(q, a.key) ?? 0)) })) }] }} />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="評分" description="自訂評分模板，非 SCA 官方標準" />
                <SimpleTable head={["項目", "分數"]} rows={[...attrs.map((a) => [a.label, fmtNum(sc(x, a.key), 2)]), [<b key="t">平均</b>, <b key="v">{fmtNum(x.totalScore, 2)}</b>]]} />
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader title="杯測紀錄" />
                <CardBody>
                  <KV
                    cols={4}
                    items={[
                      ["烘焙批次", x.roastBatchId ? <A key="r" href={`/roasting/view/?id=${x.roastBatchId}`}>{x.batchNo}</A> : `樣品（沒有烘豆紀錄）${x.sampleRoastedDate ? `・烘焙日 ${x.sampleRoastedDate}` : ""}`],
                      ["研磨度", x.grindSetting],
                      ["粉量／水量", `${fmtNum(x.doseG, 2)} g／${fmtNum(x.waterG, 1)} g`],
                      ["水溫", x.waterTempC ? `${x.waterTempC}°C` : "—"],
                      ["風味標籤", (x.tags ?? []).length ? <span key="t" className="flex flex-wrap gap-1">{(x.tags as string[]).map((g) => <Badge key={g} tone="primary">{g}</Badge>)}</span> : "—"],
                      ["瑕疵", x.defects],
                      ["評分者", x.evaluator],
                      ["熟豆耗用", x.consumedG ? `${fmtNum(x.consumedG, 1)} g` : "—"],
                      ["描述", x.description],
                    ]}
                  />
                </CardBody>
              </Card>
            </div>
          </>
        );
      }}
    </Guard>
  );
}
