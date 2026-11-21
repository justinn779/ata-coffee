import { prisma } from "@/lib/db";
import { fmtGrams, fmtMoney, fmtMoney2, fmtNum, fmtPct } from "@/lib/decimal";
import { currentMonthTaipei, fmtDbDate, monthRangeTaipei, todayTaipei } from "@/lib/time";
import { COST_CATEGORY } from "@/lib/labels";
import { lossStats, monthlyReport, skuPerformance } from "@/server/domain/reports";
import { ActionDialog } from "@/components/action-dialog";
import { Chart } from "@/components/chart";
import { Card, CardBody, CardHeader, LinkButton, Notice, PageHeader, SimpleTable, StatCard } from "@/components/ui";
import { addAllocationRule, addPeriodExpense } from "./actions";

export const metadata = { title: "成本與報表" };

const METHOD: Record<string, string> = { PER_BATCH: "每批固定", PER_KG_GREEN: "每公斤生豆", PER_UNIT: "每件成品", PERCENT_OF_REVENUE: "營收百分比" };

function prevMonths(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: m } = await searchParams;
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : currentMonthTaipei();
  const { start, end } = monthRangeTaipei(month);
  const months = prevMonths(month, 6);
  const [r, history, skus, loss, rules, periodCosts] = await Promise.all([
    monthlyReport(month),
    Promise.all(months.map((x) => monthlyReport(x))),
    skuPerformance(start, end),
    lossStats(start, end),
    prisma.costAllocationRule.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.costEntry.findMany({ where: { target: "PERIOD", occurredOn: { gte: new Date(month + "-01T00:00:00Z"), lt: new Date(end.getTime() + 8 * 3600_000) } }, orderBy: { occurredOn: "desc" } }),
  ]);
  const chart = {
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: months },
    yAxis: { type: "value", name: "TWD" },
    series: [
      { name: "商品銷售淨額", type: "bar", data: history.map((h) => Number(h.netSales.toFixed(0))) },
      { name: "銷貨毛利", type: "bar", data: history.map((h) => Number(h.grossProfit.toFixed(0))) },
      { name: "訂單貢獻利益", type: "line", data: history.map((h) => Number(h.contribution.toFixed(0))) },
      { name: "營業淨利（管理用）", type: "line", data: history.map((h) => Number(h.netOperatingProfit.toFixed(0))) },
    ],
  };
  return (
    <>
      <PageHeader
        title="成本與報表"
        description="管理會計與營運報表，非正式稅務申報系統。營收於出貨月份認列，金額與成本採訂單快照。"
        actions={
          <>
            <form className="flex items-center gap-2">
              <input type="month" name="month" defaultValue={month} aria-label="報表月份" className="h-10 rounded-lg border border-border bg-surface px-2 text-sm" />
              <button className="h-10 rounded-lg border border-border-strong px-3 text-sm">套用</button>
            </form>
            <LinkButton href={`/api/export/monthly-report?month=${month}`} variant="outline" prefetch={false}>
              匯出 CSV
            </LinkButton>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="商品銷售淨額（未稅）" value={fmtMoney(r.netSales)} hint={`${r.orderCount} 筆出貨訂單`} />
        <StatCard label="銷貨毛利" value={fmtMoney(r.grossProfit)} hint={`毛利率 ${fmtPct(r.grossMarginPct)}`} tone="sage" />
        <StatCard label="訂單貢獻利益" value={fmtMoney(r.contribution)} hint="含運費收入、扣訂單直接成本" />
        <StatCard label="營業淨利（管理用）" value={fmtMoney(r.netOperatingProfit)} hint="再扣期間營運費用" tone={r.netOperatingProfit.isNegative() ? "danger" : "primary"} />
      </div>
      {r.estimatedCostShare.gt(0) && (
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
              ["− 期間營運費用", fmtMoney2(r.operatingExpenses), "OPERATING_EXPENSE 成本紀錄"],
              [<b key="n">＝ 營業淨利（管理用）</b>, <b key="nv">{fmtMoney2(r.netOperatingProfit)}</b>, ""],
              ["代收營業稅（不計入營收）", fmtMoney2(r.taxCollected), "訂單稅額快照"],
              ["折扣合計", fmtMoney2(r.discounts), "已反映於商品淨額"],
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="近 6 個月趨勢" description="單位：新臺幣（TWD）" />
          <CardBody>
            <Chart option={chart} height={320} ariaLabel="近六個月營收與毛利趨勢" />
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="SKU 銷售表現與毛利" description={`${month} 出貨`} />
        <SimpleTable head={["SKU", "商品", "數量", "銷售淨額", "COGS", "毛利", "毛利率"]} rows={skus.map((s) => [s.sku, s.name, s.qty, fmtMoney(s.revenue), fmtMoney(s.cogs), fmtMoney(s.margin), fmtPct(s.marginPct)])} empty="本月沒有出貨" />
      </Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="損耗統計" description={`${month}`} />
          <SimpleTable
            head={["項目", "數值"]}
            rows={[
              ["烘焙批次數", loss.roastCount],
              ["投入生豆／產出熟豆", `${fmtGrams(loss.greenIn)}／${fmtGrams(loss.roastedOut)}`],
              ["平均失重率", fmtPct(loss.avgWeightLossPct, 2)],
              ["分裝損耗", fmtGrams(loss.packagingLossG, 1)],
              ["杯測耗用", fmtGrams(loss.cuppingG, 1)],
              ["試喝耗用", fmtGrams(loss.tastingG, 1)],
              ["樣品贈送", fmtGrams(loss.sampleG, 1)],
              ["報廢（重量類）", fmtGrams(loss.scrapG, 1)],
            ]}
          />
        </Card>
        <Card>
          <CardHeader
            title="期間營運費用"
            action={
              <ActionDialog
                label="＋ 新增"
                size="sm"
                variant="outline"
                title="新增期間營運費用"
                fields={[
                  { name: "calcNote", label: "項目說明", required: true },
                  { name: "amount", label: "金額（TWD）", type: "number", required: true },
                  { name: "occurredOn", label: "日期", type: "date", required: true, defaultValue: todayTaipei() },
                  { name: "isEstimate", label: "成本性質", type: "select", options: [{ value: "false", label: "實際" }, { value: "true", label: "估計" }] },
                ]}
                action={addPeriodExpense}
              />
            }
          />
          <SimpleTable head={["日期", "項目", "金額", "性質"]} rows={periodCosts.map((c) => [fmtDbDate(c.occurredOn), c.calcNote ?? "—", fmtMoney(c.amount), c.isEstimate ? "估計" : "實際"])} empty="本月無營運費用" />
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader
          title="成本分攤規則"
          description="保存估計成本的計算方式（例：烘焙能源每批 NT$18）。第一版作為輸入參考，套用時請於烘焙／分裝表單填入並註記計算方式。"
          action={
            <ActionDialog
              label="＋ 新增規則"
              size="sm"
              variant="outline"
              title="新增成本分攤規則"
              fields={[
                { name: "name", label: "規則名稱", required: true },
                { name: "category", label: "成本類別", type: "select", options: Object.entries(COST_CATEGORY).map(([value, label]) => ({ value, label })) },
                { name: "method", label: "分攤方式", type: "select", options: Object.entries(METHOD).map(([value, label]) => ({ value, label })) },
                { name: "rate", label: "費率（金額或百分比）", type: "number", required: true },
                { name: "description", label: "說明", type: "textarea" },
              ]}
              action={addAllocationRule}
            />
          }
        />
        <SimpleTable head={["名稱", "類別", "方式", "費率", "說明"]} rows={rules.map((x) => [x.name, COST_CATEGORY[x.category], METHOD[x.method] ?? x.method, fmtNum(x.rate, 4), x.description ?? "—"])} empty="尚無規則" />
      </Card>
    </>
  );
}
