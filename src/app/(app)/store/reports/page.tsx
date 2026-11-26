"use client";

import { useState } from "react";
import { useOp } from "@/lib/data";
import { fmtMoney } from "@/lib/decimal";
import { currentMonthTaipei, todayTaipei } from "@/lib/time";
import { ErrorBox } from "@/lib/page";
import { Card, CardBody, CardHeader, Notice, PageHeader, StatCard } from "@/components/ui";

interface Report {
  orderCount: number;
  counts: Record<string, number>;
  ordered: string;
  paid: string;
  completedRevenue: string;
  refunds: string;
  merchandiseNet: string;
  discount: string;
  shippingCollected: string;
  logisticsCost: string;
  directFees: string;
  cogs: string;
  itemsWithoutCost: number;
  grossProfit: string;
  contribution: string;
}

/** 電商報表：只統計商城訂單；未付款訂單不算營收，退款只扣一次 */
export default function StoreReports() {
  const [from, setFrom] = useState(`${currentMonthTaipei()}-01`);
  const [to, setTo] = useState(todayTaipei());
  const r = useOp<Report>("store.report", { from, to });
  const d = r.data;
  return (
    <>
      <PageHeader title="電商報表" description="依下單日期統計商城訂單。已實現收入＝已付款且已出貨的訂單（扣除退款）" />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-muted">
          開始
          <input type="date" className="h-10 rounded-lg border border-border bg-bg px-3 text-sm text-fg" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          結束
          <input type="date" className="h-10 rounded-lg border border-border bg-bg px-3 text-sm text-fg" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {r.error && <ErrorBox message={r.error} />}
      {d && (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="訂單金額（未取消）" value={fmtMoney(d.ordered)} hint={`${d.orderCount} 筆`} />
            <StatCard label="已收款" value={fmtMoney(d.paid)} />
            <StatCard label="已實現收入" value={fmtMoney(d.completedRevenue)} tip="已付款且已出貨，扣除退款" />
            <StatCard label="退款" value={fmtMoney(d.refunds)} />
          </div>
          <Card>
            <CardHeader title="已實現訂單的獲利" description="商品成本使用實際分配的烘焙批次、分裝與包材成本（出貨時固定，不會被之後的成本覆蓋）" />
            <CardBody>
              <dl className="grid gap-2 text-sm md:max-w-md">
                {(
                  [
                    ["商品實收（已扣折扣）", d.merchandiseNet],
                    ["其中折扣", d.discount],
                    ["退款", d.refunds],
                    ["商品成本", d.cogs],
                    ["毛利", d.grossProfit],
                    ["實收運費", d.shippingCollected],
                    ["實際物流成本", d.logisticsCost],
                    ["金流／平台等直接費用", d.directFees],
                    ["貢獻利益", d.contribution],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className={`flex justify-between ${k === "毛利" || k === "貢獻利益" ? "border-t border-border pt-2 font-medium" : ""}`}>
                    <dt className={k === "其中折扣" ? "pl-4 text-muted" : ""}>{k}</dt>
                    <dd className="tabular-nums">{fmtMoney(v)}</dd>
                  </div>
                ))}
              </dl>
              {d.itemsWithoutCost > 0 && (
                <div className="mt-4">
                  <Notice tone="warning">{d.itemsWithoutCost} 項明細還沒有實際成本（尚未分配批次），毛利可能偏高。</Notice>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
