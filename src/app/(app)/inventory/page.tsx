import type { InventoryKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D, fmtGrams, fmtMoney, fmtNum } from "@/lib/decimal";
import { fmtDate, fmtDbDate } from "@/lib/time";
import { LOT_STATUS } from "@/lib/labels";
import { itemSummaries, KIND_LABEL, reconcile } from "@/server/domain/inventory";
import { getSettings } from "@/server/domain/settings";
import { ActionDialog } from "@/components/action-dialog";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status";
import { Badge, Card, CardHeader, LinkButton, Notice, PageHeader, SimpleTable, Tabs } from "@/components/ui";
import { receiveMaterial, setThreshold } from "./actions";

export const metadata = { title: "庫存中心" };
const KINDS: InventoryKind[] = ["GREEN", "ROASTED", "FINISHED", "MATERIAL"];

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ kind?: string; low?: string }> }) {
  const sp = await searchParams;
  const kind = (KINDS.includes(sp.kind as InventoryKind) ? sp.kind : "GREEN") as InventoryKind;
  const settings = await getSettings();
  const [items, lots, diff, materials] = await Promise.all([
    prisma.$transaction((tx) => itemSummaries(tx, kind)),
    prisma.inventoryLot.findMany({ where: { item: { kind }, OR: [{ onHand: { gt: 0 } }, { reserved: { gt: 0 } }] }, include: { item: true, location: true }, orderBy: { createdAt: "desc" } }),
    prisma.$transaction((tx) => reconcile(tx)),
    kind === "MATERIAL" ? prisma.material.findMany({ where: { isActive: true } }) : Promise.resolve([]),
  ]);
  const unitFmt = (v: unknown, unit: string) => (unit === "G" ? fmtGrams(v as string, 1) : `${fmtNum(v as string, 0)} 件`);
  const defLow = { GREEN: settings.inventory.lowGreenG, ROASTED: settings.inventory.lowRoastedG, FINISHED: settings.inventory.lowFinishedPcs, MATERIAL: 0 }[kind];
  const isLow = (i: (typeof items)[number]) => {
    const th = i.lowStockThreshold != null ? D(i.lowStockThreshold) : D(defLow);
    return th.gt(0) && D(i.available).lt(th);
  };
  const shown = sp.low ? items.filter(isLow) : items;
  return (
    <>
      <PageHeader
        title="庫存中心"
        description="在庫 = 帳本加總；可用 = 在庫 − 保留。所有異動皆寫入不可修改的庫存帳本。"
        actions={
          <>
            <LinkButton href="/inventory/ledger" variant="outline">
              庫存帳本
            </LinkButton>
            {kind === "MATERIAL" && materials.length > 0 && (
              <ActionDialog
                label="＋ 包材入庫"
                title="包材入庫"
                fields={[
                  { name: "materialId", label: "包材", type: "select", required: true, options: materials.map((m) => ({ value: m.id, label: `${m.code}｜${m.name}` })) },
                  { name: "quantity", label: "數量（件）", type: "number", required: true },
                  { name: "unitCost", label: "單位成本（TWD）", type: "number", required: true },
                  { name: "note", label: "備註", type: "textarea" },
                ]}
                action={receiveMaterial}
              />
            )}
            {kind === "GREEN" && <LinkButton href="/green/new">＋ 生豆採購</LinkButton>}
            {kind === "FINISHED" && <LinkButton href="/production/new">＋ 分裝</LinkButton>}
          </>
        }
      />
      {diff.length === 0 ? (
        <p className="mb-4 text-xs text-sage">✓ 對帳正常：所有批次在庫量與帳本加總一致、保留量與有效保留加總一致</p>
      ) : (
        <div className="mb-4">
          <Notice tone="danger">對帳異常：{diff.map((d) => d.lotCode).join("、")} 的餘額與帳本不一致，請聯絡系統管理員。</Notice>
        </div>
      )}
      <Tabs active={kind} tabs={KINDS.map((k) => ({ key: k, label: KIND_LABEL[k], href: `/inventory?kind=${k}` }))} />
      <Card className="mb-6">
        <CardHeader title={`${KIND_LABEL[kind]}品項彙總`} description={sp.low ? "僅顯示低於預警的品項" : `未個別設定時使用系統預設預警值 ${defLow}`} action={sp.low ? <a className="text-sm text-primary" href={`/inventory?kind=${kind}`}>顯示全部</a> : <a className="text-sm text-primary" href={`/inventory?kind=${kind}&low=1`}>僅低庫存</a>} />
        <SimpleTable
          head={["品項", "在庫", "保留", "可用", ...(kind === "FINISHED" ? ["待檢"] : []), "庫存成本", "預警", ""]}
          rows={shown.map((i) => [
            <span key="n">
              {i.name} {isLow(i) && <Badge tone="warning">低庫存</Badge>}
            </span>,
            unitFmt(i.onHand, i.unit),
            unitFmt(i.reserved, i.unit),
            <b key="a">{unitFmt(i.available, i.unit)}</b>,
            ...(kind === "FINISHED" ? [unitFmt(i.quarantine, i.unit)] : []),
            fmtMoney(i.value),
            i.lowStockThreshold != null ? unitFmt(i.lowStockThreshold, i.unit) : "預設",
            <ActionDialog key="t" label="預警" size="sm" variant="ghost" title={`設定預警：${i.name}`} payload={{ itemId: i.itemId }} fields={[{ name: "threshold", label: `預警數量（${i.unit === "G" ? "g" : "件"}）`, type: "number", required: true, defaultValue: i.lowStockThreshold ?? String(defLow) }]} action={setThreshold} />,
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
        rows={lots.map((l) => ({
          id: l.id,
          href: `/inventory/lots/${l.id}`,
          search: [l.lotCode, l.item.name, l.location?.name, l.note].join(" "),
          filters: { status: l.status },
          sort: { lot: l.lotCode, onHand: Number(l.onHand), date: (l.producedAt ?? l.createdAt).getTime(), exp: l.expiryDate?.getTime() ?? null },
          cells: {
            lot: l.lotCode,
            item: l.item.name,
            status: <StatusBadge map={LOT_STATUS} value={l.status} />,
            onHand: unitFmt(l.onHand, l.item.unit),
            reserved: unitFmt(l.reserved, l.item.unit),
            cost: `NT$ ${fmtNum(l.unitCost, 4)}`,
            date: fmtDate(l.producedAt ?? l.createdAt),
            exp: fmtDbDate(l.expiryDate),
          },
        }))}
      />
    </>
  );
}
