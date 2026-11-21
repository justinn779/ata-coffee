"use client";

import Link from "next/link";
import { fmtDbDate } from "@/lib/time";
import { SERIES_CHARACTER } from "@/lib/labels";
import { useCol } from "@/lib/data";
import { Guard } from "@/lib/page";
import { MascotPlaceholder } from "@/components/brand";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";

export default function SeriesPage() {
  const s = useCol("brandSeries", [], "code", false);
  const products = useCol("products");
  return (
    <>
      <PageHeader title="品牌系列與履歷" description="ATA 系列、Ati／Ato 特別版、節日限定；QR Code 商品履歷只公開安全欄位" actions={<LinkButton href="/series/new/">＋ 新增系列</LinkButton>} />
      <Guard loading={s.loading} error={s.error}>
        {() =>
          s.data.length === 0 ? (
            <EmptyState title="尚無品牌系列" action={<LinkButton href="/series/new/">新增系列</LinkButton>} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {s.data.map((x) => (
                <Link key={x.id} href={`/series/view/?id=${x.id}`} className="block">
                  <Card className="h-full p-5 transition-colors hover:border-border-strong">
                    <div className="flex items-start gap-4">
                      <div className="w-16 shrink-0">{x.character === "ATI" || x.character === "ATO" ? <MascotPlaceholder name={x.character === "ATI" ? "Ati" : "Ato"} /> : <div className="flex aspect-square items-center justify-center rounded-xl bg-primary-soft font-serif text-xs text-primary">{x.code}</div>}</div>
                      <div className="min-w-0">
                        <p className="text-xs text-muted">{x.code}</p>
                        <p className="font-serif text-lg font-semibold">{x.name}</p>
                        <p className="mt-1 line-clamp-2 text-sm text-muted">{x.story ?? x.flavorNotes ?? "—"}</p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {x.isLimited && <Badge tone="primary">限定</Badge>}
                          {x.character !== "NONE" && <Badge tone="info">{SERIES_CHARACTER[x.character]}</Badge>}
                          <Badge>{products.data.filter((p) => p.brandSeriesId === x.id).length} 項商品</Badge>
                          {x.launchDate && <Badge>上市 {fmtDbDate(x.launchDate)}</Badge>}
                        </div>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )
        }
      </Guard>
    </>
  );
}
