import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDbDate } from "@/lib/time";
import { SERIES_CHARACTER } from "@/lib/labels";
import { MascotPlaceholder } from "@/components/brand";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "品牌系列與履歷" };

export default async function SeriesPage() {
  const series = await prisma.brandSeries.findMany({ orderBy: { code: "asc" }, include: { _count: { select: { products: true } } } });
  return (
    <>
      <PageHeader title="品牌系列與履歷" description="ATA 系列、Ati／Ato 特別版、節日限定；QR Code 商品履歷只公開安全欄位" actions={<LinkButton href="/series/new">＋ 新增系列</LinkButton>} />
      {series.length === 0 ? (
        <EmptyState title="尚無品牌系列" action={<LinkButton href="/series/new">新增系列</LinkButton>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {series.map((s) => (
            <Link key={s.id} href={`/series/${s.id}`} className="block">
              <Card className="h-full p-5 transition-colors hover:border-border-strong">
                <div className="flex items-start gap-4">
                  <div className="w-16 shrink-0">{s.character === "ATI" || s.character === "ATO" ? <MascotPlaceholder name={s.character === "ATI" ? "Ati" : "Ato"} /> : <div className="flex aspect-square items-center justify-center rounded-xl bg-primary-soft font-serif text-xs text-primary">{s.code}</div>}</div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted">{s.code}</p>
                    <p className="font-serif text-lg font-semibold">{s.name}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted">{s.story ?? s.flavorNotes ?? "—"}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.isLimited && <Badge tone="primary">限定</Badge>}
                      {s.character !== "NONE" && <Badge tone="info">{SERIES_CHARACTER[s.character]}</Badge>}
                      <Badge>{s._count.products} 項商品</Badge>
                      {s.launchDate && <Badge>上市 {fmtDbDate(s.launchDate)}</Badge>}
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
