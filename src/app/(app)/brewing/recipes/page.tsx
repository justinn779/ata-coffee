import { prisma } from "@/lib/db";
import { fmtNum } from "@/lib/decimal";
import { fmtDate, fmtSec } from "@/lib/time";
import { ActionDialog } from "@/components/action-dialog";
import { Badge, LinkButton, PageHeader, SimpleTable, Tabs, Card, A } from "@/components/ui";
import { toggleRecipeRecommended } from "../actions";

export const metadata = { title: "手沖配方" };

export default async function RecipesPage() {
  const recipes = await prisma.brewRecipe.findMany({ orderBy: [{ name: "asc" }, { version: "desc" }], include: { coffee: true, dripper: true, _count: { select: { sessions: true } } } });
  return (
    <>
      <PageHeader title="手沖實驗室" description="配方版本：於沖煮紀錄頁「存為配方」建立；同名配方自動遞增版本" actions={<LinkButton href="/brewing/new">＋ 新增手沖</LinkButton>} />
      <Tabs active="recipes" tabs={[{ key: "sessions", label: "沖煮紀錄", href: "/brewing" }, { key: "recipes", label: "配方", href: "/brewing/recipes", count: recipes.length }]} />
      <Card>
        <SimpleTable
          head={["配方", "版本", "咖啡豆", "粉／水", "水溫", "時間", "濾杯", "使用次數", "建立", ""]}
          rows={recipes.map((r) => [
            <span key="n">
              {r.name} {r.isRecommended && <Badge tone="sage">推薦</Badge>}
            </span>,
            `v${r.version}`,
            r.coffee?.nameZh ?? "—",
            `${fmtNum(r.doseG, 1)}g／${fmtNum(r.waterG, 0)}g`,
            r.waterTempC ? `${r.waterTempC}°C` : "—",
            fmtSec(r.totalTimeSec),
            r.dripper?.name ?? "—",
            r._count.sessions,
            fmtDate(r.createdAt),
            <span key="a" className="flex gap-2">
              <A href={`/brewing/new?recipe=${r.id}`}>使用</A>
              <ActionDialog label={r.isRecommended ? "取消推薦" : "推薦"} size="sm" variant="ghost" title="切換推薦配方？" payload={{ id: r.id }} action={toggleRecipeRecommended} />
            </span>,
          ])}
          empty="尚無配方"
        />
      </Card>
    </>
  );
}
