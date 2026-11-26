"use client";

import { fmtNum } from "@/lib/decimal";
import { fmtDate, fmtSec } from "@/lib/time";
import { opAction } from "@/lib/api";
import { useCol } from "@/lib/data";
import { ActionDialog } from "@/components/action-dialog";
import { DeleteButton } from "@/components/delete-button";
import { A, Badge, Card, LinkButton, PageHeader, SimpleTable, Tabs } from "@/components/ui";

export default function RecipesPage() {
  const r = useCol("brewRecipes", [], "name", false);
  const sessions = useCol("brewSessions");
  const list = [...r.data].sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version);
  return (
    <>
      <PageHeader title="手沖" description="配方版本：於沖煮紀錄頁「存為配方」建立；同名配方自動遞增版本" actions={<LinkButton href="/brewing/new/">＋ 新增手沖</LinkButton>} />
      <Tabs active="recipes" tabs={[{ key: "sessions", label: "沖煮紀錄", href: "/brewing/" }, { key: "recipes", label: "配方", href: "/brewing/recipes/", count: list.length }]} />
      <Card>
        <SimpleTable
          head={["配方", "版本", "咖啡豆", "粉／水", "水溫", "時間", "濾杯", "使用次數", "建立", ""]}
          rows={list.map((x) => [
            <span key="n">{x.name} {x.isRecommended && <Badge tone="sage">推薦</Badge>}</span>,
            `v${x.version}`,
            x.coffeeName ?? "—",
            `${fmtNum(x.doseG, 1)}g／${fmtNum(x.waterG, 0)}g`,
            x.waterTempC ? `${x.waterTempC}°C` : "—",
            fmtSec(x.totalTimeSec),
            x.dripperName ?? "—",
            sessions.data.filter((s) => s.recipeId === x.id).length,
            fmtDate(x.createdAt),
            <span key="a" className="flex gap-2">
              <A href={`/brewing/new/?recipe=${x.id}`}>使用</A>
              <ActionDialog label={x.isRecommended ? "取消推薦" : "推薦"} size="sm" variant="ghost" title="切換推薦配方？" payload={{ id: x.id }} action={opAction("recipe.toggleRecommended")} />
              <DeleteButton what="配方" name={`${x.name} v${x.version}`} col="brewRecipes" id={x.id} description="有其他紀錄用到時，會先提醒你確認。" />
            </span>,
          ])}
          empty={r.loading ? "載入中…" : "尚無配方"}
        />
      </Card>
    </>
  );
}
