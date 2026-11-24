"use client";

import { opAction } from "@/lib/api";
import { useCol, type Row } from "@/lib/data";
import { Guard } from "@/lib/page";
import { ActionDialog, type DialogField } from "@/components/action-dialog";
import { DeleteButton } from "@/components/delete-button";
import { A, Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, SimpleTable } from "@/components/ui";

const s = (v: unknown) => (v == null ? "" : String(v));

/** 依出現次數排序的風味標籤 */
function topTags(rows: Row[], n = 8) {
  const count = new Map<string, number>();
  for (const r of rows) for (const t of (r.tags as string[] | undefined) ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function Tags({ list }: { list: Array<[string, number]> }) {
  if (!list.length) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map(([t, c]) => (
        <Badge key={t}>
          {t}
          {c > 1 && <span className="ml-1 text-muted">×{c}</span>}
        </Badge>
      ))}
    </span>
  );
}

/** 風味描述：每支咖啡豆的原始風味敘述，與杯測、手沖紀錄中實際記下的風味 */
export default function FlavorsPage() {
  const coffees = useCol("coffees", [], "code", false);
  const cups = useCol("cuppingSessions");
  const brews = useCol("brewSessions");
  const tags = useCol("flavorTags", [], "createdAt", false);
  const fields = (x?: Row): DialogField[] => [
    { name: "name", label: "詞彙", required: true, defaultValue: s(x?.name) },
    { name: "category", label: "分類", defaultValue: s(x?.category) },
  ];
  return (
    <>
      <PageHeader title="風味描述" description="每支咖啡豆的原始風味，以及杯測、手沖紀錄中記下的風味（依出現次數）" />
      <Guard loading={coffees.loading || cups.loading || brews.loading} error={coffees.error ?? cups.error ?? brews.error}>
        {() => (
          <div className="grid gap-6">
            {coffees.data.filter((c) => !c.archivedAt).length === 0 ? (
              <EmptyState title="尚未建立咖啡豆" description="建立咖啡豆後，這裡會整理每支豆子的風味" action={<LinkButton href="/coffees/new/">新增咖啡豆</LinkButton>} />
            ) : (
              <Card>
                <CardHeader title="各支咖啡豆風味" description="原始風味請在「咖啡豆」頁編輯；杯測、手沖的風味標籤在各紀錄填寫" />
                <SimpleTable
                  head={["咖啡豆", "原始風味敘述", "杯測風味", "手沖風味"]}
                  rows={coffees.data
                    .filter((c) => !c.archivedAt)
                    .map((c) => [
                      <A key="n" href={`/coffees/view/?id=${c.id}`}>
                        {c.nameZh} <span className="text-xs text-muted">{c.code}</span>
                      </A>,
                      <span key="o" className="whitespace-pre-line">{c.originFlavorNotes || "—"}</span>,
                      <Tags key="c" list={topTags(cups.data.filter((x) => x.coffeeId === c.id))} />,
                      <Tags key="b" list={topTags(brews.data.filter((x) => x.coffeeId === c.id))} />,
                    ])}
                />
              </Card>
            )}
            <Card>
              <CardHeader title="風味詞彙" description="杯測／手沖輸入的新詞彙會自動加入；可在這裡新增或整理分類" action={<ActionDialog label="＋ 新增" size="sm" title="新增風味詞彙" fields={fields()} action={opAction("flavor.save")} />} />
              <SimpleTable
                head={["詞彙", "分類", ""]}
                rows={tags.data.map((x) => [x.name, x.category ?? "—", <span key="e" className="flex gap-1"><ActionDialog label="編輯" size="sm" variant="ghost" title="編輯風味詞彙" description="改名後，杯測、手沖紀錄裡的這個詞會一起更新" payload={{ id: x.id }} fields={fields(x)} action={opAction("flavor.save")} /><DeleteButton what="風味詞彙" name={x.name} col="flavorTags" id={x.id} description="只從詞彙表移除，已寫在杯測、手沖紀錄裡的詞不會被刪掉。" /></span>])}
                empty={tags.loading ? "載入中…" : "尚無資料"}
              />
            </Card>
          </div>
        )}
      </Guard>
    </>
  );
}
