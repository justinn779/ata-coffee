"use client";

import { D, fmtNum } from "@/lib/decimal";
import { fmtDateTime } from "@/lib/time";
import { useCol } from "@/lib/data";
import { Guard } from "@/lib/page";
import { downloadCsv } from "@/lib/csv";
import { DataTable } from "@/components/data-table";
import { Button, PageHeader } from "@/components/ui";

const TX: Record<string, string> = { RECEIPT: "入庫", ROAST_ISSUE: "烘焙領料", ROAST_OUTPUT: "烘焙產出", CUPPING_USE: "杯測耗用", TASTING_USE: "試喝耗用", SAMPLE_GIFT: "樣品贈送", PACKAGING_ISSUE: "分裝耗用", PACKAGING_LOSS: "分裝損耗", PACKAGING_OUTPUT: "分裝產出", MATERIAL_ISSUE: "包材耗用", SCRAP: "報廢", ADJUSTMENT: "盤點調整", SHIPMENT_ISSUE: "出貨扣帳", RETURN_QUARANTINE: "退貨待檢", RETURN_RESTOCK_OUT: "退貨轉出待檢區", RETURN_RESTOCK_IN: "退貨重新入庫", REVERSAL: "沖銷" };
const KIND: Record<string, string> = { GREEN: "生豆", ROASTED: "熟豆", FINISHED: "成品", MATERIAL: "包材" };

export default function LedgerPage() {
  const txs = useCol("invTxs", [], "occurredAt");
  return (
    <>
      <PageHeader
        title="庫存帳本"
        description={`共 ${txs.data.length} 筆異動（全部類別）`}
        back={{ href: "/inventory/", label: "庫存中心" }}
        actions={<Button variant="outline" onClick={() => downloadCsv("inventory-ledger", txs.data.map((t) => ({ transactionId: t.id, groupId: t.groupId, occurredAt: t.occurredAt, kind: t.kind, item: t.itemName, lot: t.lotCode, type: t.type, quantity: t.quantity, unit: t.unit, unitCost: t.unitCost, balanceAfter: t.balanceAfter, refType: t.refType, refId: t.refId, reversesId: t.reversesId, actor: t.actorName, note: t.note })))}>匯出 CSV</Button>}
      />
      <Guard loading={txs.loading} error={txs.error}>
        {() => (
          <DataTable
            pageSize={50}
            columns={[
              { key: "time", label: "時間", sortable: true },
              { key: "type", label: "類型" },
              { key: "kind", label: "類別", hideOnMobile: true },
              { key: "lot", label: "批次" },
              { key: "item", label: "品項", hideOnMobile: true },
              { key: "qty", label: "異動量", align: "right", sortable: true },
              { key: "bal", label: "結餘", align: "right", hideOnMobile: true },
              { key: "who", label: "操作者", hideOnMobile: true },
              { key: "note", label: "備註", hideOnMobile: true },
            ]}
            filters={[
              { key: "type", label: "類型", options: Object.entries(TX).map(([value, label]) => ({ value, label })) },
              { key: "kind", label: "類別", options: Object.entries(KIND).map(([value, label]) => ({ value, label })) },
            ]}
            rows={txs.data.map((t) => ({
              id: t.id,
              href: `/inventory/lot/?id=${t.lotId}`,
              search: [t.id, t.lotCode, t.itemName, t.note, TX[t.type]].join(" "),
              filters: { type: t.type, kind: t.kind },
              sort: { time: t.occurredAt, qty: Number(t.quantity) },
              cells: {
                time: fmtDateTime(t.occurredAt),
                type: TX[t.type],
                kind: KIND[t.kind],
                lot: t.lotCode,
                item: t.itemName,
                qty: <span className={D(t.quantity).isNegative() ? "text-danger" : "text-sage"}>{D(t.quantity).isNegative() ? "" : "+"}{fmtNum(t.quantity, 1)} {t.unit === "G" ? "g" : "件"}</span>,
                bal: fmtNum(t.balanceAfter, 1),
                who: t.actorName ?? "系統",
                note: t.note ?? "—",
              },
            }))}
          />
        )}
      </Guard>
    </>
  );
}
