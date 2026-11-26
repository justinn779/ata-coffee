"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { D, fmtGrams, fmtMoney, fmtNum } from "@/lib/decimal";
import { fmtDate, fmtDbDate } from "@/lib/time";
import { LOT_STATUS } from "@/lib/labels";
import { callOp, opAction } from "@/lib/api";
import { useCol, useDocument } from "@/lib/data";
import { Guard, useQS } from "@/lib/page";
import { ActionDialog } from "@/components/action-dialog";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status";
import { Badge, Card, CardHeader, LinkButton, Notice, PageHeader, SimpleTable, Tabs } from "@/components/ui";

const KINDS = ["GREEN", "ROASTED", "FINISHED", "MATERIAL"] as const;
const LABEL: Record<string, string> = { GREEN: "生豆", ROASTED: "熟豆", FINISHED: "成品", MATERIAL: "包材" };

export default function InventoryPage() {
  const k = useQS("kind");
  const lowOnly = useQS("low");
  const kind = (KINDS as readonly string[]).includes(k ?? "") ? (k as string) : "GREEN";
  const items = useCol("invItems", [["kind", kind]], "name", false);
  const lots = useCol("invLots", [["kind", kind]], "createdAt");
  const materials = useCol(kind === "MATERIAL" ? "materials" : null, [], "code", false);
  const inv = useDocument("settings", "inventory");
  const [recon, setRecon] = useState<{ ok: boolean; bad: string[] } | null>(null);
  useEffect(() => {
    callOp<unknown[]>("inventory.reconcile").then((r) => setRecon(r.ok ? { ok: (r.data as unknown as unknown[]).length === 0, bad: (r.data as unknown as Array<{ lotCode: string }>).map((x) => x.lotCode) } : null));
  }, [lots.data.length]);
  const s = { lowGreenG: 3000, lowRoastedG: 500, lowFinishedPcs: 5, ...(inv.data ?? {}) };
  const defLow = ({ GREEN: s.lowGreenG, ROASTED: s.lowRoastedG, FINISHED: s.lowFinishedPcs, MATERIAL: 0 } as Record<string, number>)[kind];
  const uf = (v: unknown, unit: string) => (unit === "G" ? fmtGrams(v as string, 1) : `${fmtNum(v as string, 0)} 件`);
  const summary = items.data.map((i) => {
    const ls = lots.data.filter((l) => l.itemId === i.id);
    const av = ls.filter((l) => l.status === "AVAILABLE");
    const sum = (arr: typeof ls, f: (l: (typeof ls)[number]) => ReturnType<typeof D>) => arr.reduce((t, l) => t.add(f(l)), D(0));
    const available = sum(av, (l) => D(l.onHand).sub(l.reserved));
    const th = i.lowStockThreshold != null ? D(i.lowStockThreshold) : D(defLow);
    return { i, onHand: sum(av, (l) => D(l.onHand)), reserved: sum(av, (l) => D(l.reserved)), available, quarantine: sum(ls.filter((l) => l.status === "QUARANTINE"), (l) => D(l.onHand)), value: sum(ls, (l) => D(l.onHand).mul(l.unitCost)), low: th.gt(0) && available.lt(th) };
  });
  const shown = lowOnly ? summary.filter((x) => x.low) : summary;
  const visibleLots = lots.data.filter((l) => !D(l.onHand).isZero() || D(l.reserved).gt(0));
  const negativeLots = visibleLots.filter((l) => D(l.onHand).isNegative());
  return (
    <>
      <PageHeader
        title="庫存中心"
        description="在庫 = 帳本加總；可用 = 在庫 − 保留。所有異動皆寫入不可修改的庫存帳本。"
        actions={
          <>
            <LinkButton href={`/inventory/count/?kind=${kind}`} variant="outline">
              整批盤點
            </LinkButton>
            {kind === "MATERIAL" && materials.data.length > 0 && (
              <ActionDialog
                label="＋ 包材入庫"
                title="包材入庫"
                fields={[
                  { name: "materialId", label: "包材", type: "select", required: true, options: materials.data.map((m) => ({ value: m.id, label: `${m.code}｜${m.name}` })) },
                  { name: "quantity", label: "數量（件）", type: "number", required: true },
                  { name: "unitCost", label: "單位成本（TWD）", type: "number", required: true },
                  { name: "note", label: "備註", type: "textarea" },
                ]}
                action={opAction("inventory.receiveMaterial")}
              />
            )}
            {kind === "GREEN" && <LinkButton href="/green/new/">＋ 生豆採購</LinkButton>}
            {kind === "FINISHED" && <LinkButton href="/production/new/">＋ 分裝</LinkButton>}
          </>
        }
      />
      {recon?.ok && <p className="mb-4 text-xs text-sage">✓ 對帳正常：所有批次在庫量與帳本加總一致、保留量與有效保留加總一致</p>}
      {recon && !recon.ok && (
        <div className="mb-4">
          <Notice tone="danger">對帳異常：{recon.bad.join("、")} 的餘額與帳本不一致，請聯絡系統管理員。</Notice>
        </div>
      )}
      <Tabs active={kind} tabs={KINDS.map((x) => ({ key: x, label: LABEL[x], href: `/inventory/?kind=${x}` }))} />
      {negativeLots.length > 0 && (
        <div className="mb-4">
          <Notice tone="warning">提醒：{negativeLots.map((l) => l.lotCode).join("、")} 庫存是負數（之前庫存不足時確認照樣扣除），請補登入庫或用「整批盤點」修正。</Notice>
        </div>
      )}
      <Guard loading={items.loading || lots.loading} error={items.error ?? lots.error}>
        {() => (
          <>
            <Card className="mb-6">
              <CardHeader title={`${LABEL[kind]}品項彙總`} description={lowOnly ? "僅顯示低於預警的品項" : `未個別設定時使用系統預設預警值 ${defLow}`} action={lowOnly ? <Link className="text-sm text-primary" href={`/inventory/?kind=${kind}`}>顯示全部</Link> : <Link className="text-sm text-primary" href={`/inventory/?kind=${kind}&low=1`}>僅低庫存</Link>} />
              <SimpleTable
                head={["品項", "在庫", "保留", "可用", ...(kind === "FINISHED" ? ["待檢"] : []), "庫存成本", "預警", ""]}
                rows={shown.map((x) => [
                  <span key="n">{x.i.name} {x.low && <Badge tone="warning">低庫存</Badge>}</span>,
                  uf(x.onHand, x.i.unit),
                  uf(x.reserved, x.i.unit),
                  <b key="a">{uf(x.available, x.i.unit)}</b>,
                  ...(kind === "FINISHED" ? [uf(x.quarantine, x.i.unit)] : []),
                  fmtMoney(x.value),
                  x.i.lowStockThreshold != null ? uf(x.i.lowStockThreshold, x.i.unit) : "預設",
                  <ActionDialog key="t" label="預警" size="sm" variant="ghost" title={`設定預警：${x.i.name}`} payload={{ itemId: x.i.id }} fields={[{ name: "threshold", label: `預警數量（${x.i.unit === "G" ? "g" : "件"}）`, type: "number", required: true, defaultValue: x.i.lowStockThreshold ?? String(defLow) }]} action={opAction("inventory.threshold")} />,
                ])}
                empty="沒有品項"
              />
            </Card>
            <DataTable
              columns={[
                { key: "lot", label: "批次", sortable: true },
                { key: "item", label: "品項" },
                { key: "status", label: "狀態" },
                { key: "onHand", label: "在庫", align: "right", sortable: true },
                { key: "reserved", label: "保留", align: "right" },
                { key: "cost", label: "單位成本", align: "right", hideOnMobile: true },
                { key: "date", label: "建立／生產", sortable: true, hideOnMobile: true },
                { key: "exp", label: "有效日期", sortable: true, hideOnMobile: true },
              ]}
              filters={[{ key: "status", label: "狀態", options: Object.entries(LOT_STATUS).map(([value, [label]]) => ({ value, label })) }]}
              rows={visibleLots.map((l) => ({
                id: l.id,
                href: `/inventory/lot/?id=${l.id}`,
                search: [l.lotCode, l.itemName, l.note].join(" "),
                filters: { status: l.status },
                sort: { lot: l.lotCode, onHand: Number(l.onHand), date: l.producedAt ?? l.createdAt, exp: l.expiryDate ?? null },
                cells: { lot: l.lotCode, item: l.itemName, status: <StatusBadge map={LOT_STATUS} value={l.status} />, onHand: D(l.onHand).isNegative() ? <span className="font-medium text-danger" title="庫存為負：之前庫存不足時確認照樣扣除，請補登入庫或盤點修正">{uf(l.onHand, l.unit)} ⚠</span> : uf(l.onHand, l.unit), reserved: uf(l.reserved, l.unit), cost: `NT$ ${fmtNum(l.unitCost, 4)}`, date: fmtDate(l.producedAt ?? l.createdAt), exp: fmtDbDate(l.expiryDate) },
              }))}
            />
          </>
        )}
      </Guard>
    </>
  );
}
