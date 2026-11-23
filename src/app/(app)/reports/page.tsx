"use client";

import { useRouter } from "next/navigation";
import { D, fmtGrams, fmtMoney, fmtMoney2, fmtNum, fmtPct } from "@/lib/decimal";
import { currentMonthTaipei, fmtDbDate, todayTaipei } from "@/lib/time";
import { COST_CATEGORY } from "@/lib/labels";
import { opAction } from "@/lib/api";
import { useCol, useOp } from "@/lib/data";
import { Guard, useQS } from "@/lib/page";
import { downloadCsv } from "@/lib/csv";
import { ActionDialog } from "@/components/action-dialog";
import { DeleteButton } from "@/components/delete-button";
import { Chart } from "@/components/chart";
import { Button, Card, CardBody, CardHeader, Notice, PageHeader, SimpleTable, StatCard } from "@/components/ui";
import type { MonthlyReport } from "../../../../functions/src/domain/reports";

const METHOD: Record<string, string> = { PER_BATCH: "每批固定", PER_KG_GREEN: "每公斤生豆", PER_UNIT: "每件成品", PERCENT_OF_REVENUE: "營收百分比" };
const prev = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1)).toISOString().slice(0, 7));
};

type Sku = { sku: string; name: string; qty: number; revenue: string; cogs: string; margin: string; marginPct: string | null };
type Loss = Record<string, string | number | null>;

export default function ReportsPage() {
  const router = useRouter();
  const m = useQS("month");
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : currentMonthTaipei();
  const months = prev(month, 6);
  const rep = useOp<MonthlyReport>("report.monthly", { month });
  const hist = months.map((x) => ({ m: x, ...useHist(x) })); // eslint-disable-line react-hooks/rules-of-hooks
  const skus = useOp<Sku[]>("report.sku", { month });
  const loss = useOp<Loss>("report.loss", { month });
  const rules = useCol("costRules", [], "createdAt");
  const costs = useCol("costEntries", [["target", "PERIOD"]], "occurredOn");
  const periodCosts = costs.data.filter((c) => String(c.occurredOn).startsWith(month));
  return (
    <>
      <PageHeader
        title="成本與報表"
        description="管理會計與營運報表，非正式稅務申報系統。營收於出貨月份認列，金額與成本採訂單快照。"
        actions={
          <>
            <input type="month" value={month} onChange={(e) => router.push(`/reports/?month=${e.target.value}`)} aria-label="報表月份" className="h-10 rounded-lg border border-border bg-surface px-2 text-sm" />
            <Button variant="outline" disabled={!rep.data} onClick={() => rep.data && downloadCsv(`monthly-${month}`, Object.entries(rep.data).map(([k, v]) => ({ 項目: k, 數值: v })))}>
              匯出 CSV
            </Button>
          </>
        }
      />
      <Guard loading={rep.loading} error={rep.error} missing={!rep.data}>
        {() => {
          const r = rep.data!;
          return (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="商品銷售淨額（未稅）" value={fmtMoney(r.netSales)} hint={`${r.orderCount} 筆出貨訂單`} />
                <StatCard label="銷貨毛利" value={fmtMoney(r.grossProfit)} hint={`毛利率 ${fmtPct(r.grossMarginPct)}`} tone="sage" />
                <StatCard label="訂單貢獻利益" value={fmtMoney(r.contribution)} hint="含運費收入、扣訂單直接成本" />
                <StatCard label="營業淨利（管理用）" value={fmtMoney(r.netOperatingProfit)} hint="再扣期間營運費用" tone={D(r.netOperatingProfit).isNegative() ? "danger" : "primary"} />
              </div>
              {D(r.estimatedCostShare).gt(0) && (
                <div className="mt-4">
                  <Notice tone="warning">本月成本中有 {fmtMoney(r.estimatedCostShare)} 為「估計成本」，實際數字確定後請更新。</Notice>
                </div>
              )}
              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader title={`${month} 損益明細`} description="每一項均列出計算來源" />
                  <SimpleTable
                    head={["項目", "金額", "計算來源"]}
                    rows={[
                      ["商品銷售淨額", fmtMoney2(r.netSales), "出貨訂單明細小計（含稅價扣除內含稅）"],
                      ["− 退款", fmtMoney2(r.refunds), "當月退款紀錄"],
                      ["− 銷貨成本 COGS", fmtMoney2(r.cogs), "出貨批次數量 × 批次單位成本 − 退貨重新入庫成本"],
                      [<b key="g">＝ 銷貨毛利</b>, <b key="gv">{fmtMoney2(r.grossProfit)}</b>, ""],
                      ["＋ 運費收入", fmtMoney2(r.shippingIncome), "訂單向顧客收取之運費"],
                      ["− 訂單直接成本", fmtMoney2(r.orderDirectCosts), "物流、平台、金流手續費等（成本日期在當月）"],
                      [<b key="c">＝ 訂單貢獻利益</b>, <b key="cv">{fmtMoney2(r.contribution)}</b>, ""],
                      ["− 期間營運費用", fmtMoney2(r.operatingExpenses), "營運費用紀錄"],
                      [<b key="n">＝ 營業淨利（管理用）</b>, <b key="nv">{fmtMoney2(r.netOperatingProfit)}</b>, ""],
                      ["代收營業稅（不計入營收）", fmtMoney2(r.taxCollected), "訂單稅額快照"],
                      ["折扣合計", fmtMoney2(r.discounts), "已反映於商品淨額"],
                    ]}
                  />
                </Card>
                <Card>
                  <CardHeader title="近 6 個月趨勢" description="單位：新臺幣（TWD）" />
                  <CardBody>
                    <Chart
                      height={320}
                      ariaLabel="近六個月營收與毛利趨勢"
                      option={{ tooltip: { trigger: "axis" }, xAxis: { type: "category", data: months }, yAxis: { type: "value", name: "TWD" }, series: [{ name: "商品銷售淨額", type: "bar", data: hist.map((h) => (h.data ? Number(h.data.netSales) : null)) }, { name: "銷貨毛利", type: "bar", data: hist.map((h) => (h.data ? Number(h.data.grossProfit) : null)) }, { name: "訂單貢獻利益", type: "line", data: hist.map((h) => (h.data ? Number(h.data.contribution) : null)) }, { name: "營業淨利（管理用）", type: "line", data: hist.map((h) => (h.data ? Number(h.data.netOperatingProfit) : null)) }] }}
                    />
                  </CardBody>
                </Card>
              </div>
            </>
          );
        }}
      </Guard>
      <Card className="mt-6">
        <CardHeader title="品項銷售表現與毛利" description={`${month} 出貨`} />
        <SimpleTable head={["品項編號", "商品", "數量", "銷售淨額", "COGS", "毛利", "毛利率"]} rows={(skus.data ?? []).map((s) => [s.sku, s.name, s.qty, fmtMoney(s.revenue), fmtMoney(s.cogs), fmtMoney(s.margin), fmtPct(s.marginPct)])} empty={skus.loading ? "計算中…" : "本月沒有出貨"} />
      </Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="損耗統計" description={month} />
          {loss.data && (
            <SimpleTable
              head={["項目", "數值"]}
              rows={[
                ["烘焙批次數", loss.data.roastCount],
                ["投入生豆／產出熟豆", `${fmtGrams(loss.data.greenIn as string)}／${fmtGrams(loss.data.roastedOut as string)}`],
                ["平均失重率", fmtPct(loss.data.avgWeightLossPct as string, 2)],
                ["分裝損耗", fmtGrams(loss.data.packagingLossG as string, 1)],
                ["杯測耗用", fmtGrams(loss.data.cuppingG as string, 1)],
                ["試喝耗用", fmtGrams(loss.data.tastingG as string, 1)],
                ["樣品贈送", fmtGrams(loss.data.sampleG as string, 1)],
                ["報廢（重量類）", fmtGrams(loss.data.scrapG as string, 1)],
              ]}
            />
          )}
        </Card>
        <Card>
          <CardHeader
            title="期間營運費用"
            action={<ActionDialog label="＋ 新增" size="sm" variant="outline" title="新增期間營運費用" fields={[{ name: "calcNote", label: "項目說明", required: true }, { name: "amount", label: "金額（TWD）", type: "number", required: true }, { name: "occurredOn", label: "日期", type: "date", required: true, defaultValue: todayTaipei() }, { name: "isEstimate", label: "成本性質", type: "select", options: [{ value: "false", label: "實際" }, { value: "true", label: "估計" }] }]} action={opAction("cost.addPeriod")} />}
          />
          <SimpleTable head={["日期", "項目", "金額", "性質", ""]} rows={periodCosts.map((c) => [fmtDbDate(c.occurredOn), c.calcNote ?? "—", fmtMoney(c.amount), c.isEstimate ? "估計" : "實際", <DeleteButton key="d" what="營運費用" name={c.calcNote} id={c.id} op="cost.delete" />])} empty="本月無營運費用" />
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader
          title="成本分攤規則"
          description="保存估計成本的計算方式（例：烘焙能源每批 NT$18）。第一版作為輸入參考，套用時請於烘焙／分裝表單填入並註記計算方式。"
          action={<ActionDialog label="＋ 新增規則" size="sm" variant="outline" title="新增成本分攤規則" fields={[{ name: "name", label: "規則名稱", required: true }, { name: "category", label: "成本類別", type: "select", options: Object.entries(COST_CATEGORY).map(([value, label]) => ({ value, label })) }, { name: "method", label: "分攤方式", type: "select", options: Object.entries(METHOD).map(([value, label]) => ({ value, label })) }, { name: "rate", label: "費率（金額或百分比）", type: "number", required: true }, { name: "description", label: "說明", type: "textarea" }]} action={opAction("cost.addRule")} />}
        />
        <SimpleTable head={["名稱", "類別", "方式", "費率", "說明", ""]} rows={rules.data.map((x) => [x.name, COST_CATEGORY[x.category] ?? x.category, METHOD[x.method] ?? x.method, fmtNum(x.rate, 4), x.description ?? "—", <DeleteButton key="d" what="分攤規則" name={x.name} col="costRules" id={x.id} />])} empty="尚無規則" />
      </Card>
    </>
  );
}

function useHist(month: string) {
  return useOp<MonthlyReport>("report.monthly", { month });
}
