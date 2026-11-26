"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { shopCall, CATEGORY_LABEL, type PublicProduct } from "@/lib/shop";
import { ErrorBlock, Loading, ProductCard, Sheet, SkeletonGrid } from "../_ui";
import { QuickAdd } from "../_quick";

const SORTS = [
  { key: "featured", label: "推薦" },
  { key: "new", label: "新品" },
  { key: "price-asc", label: "價格：低到高" },
  { key: "price-desc", label: "價格：高到低" },
] as const;

function List() {
  const c = useSearchParams().get("c");
  const cat = c && ["beans", "drip", "gift"].includes(c) ? c : null;
  const [all, setAll] = useState<PublicProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("featured");
  const [onlyAvail, setOnlyAvail] = useState(false);
  const [panel, setPanel] = useState(false);
  const [quick, setQuick] = useState<PublicProduct | null>(null);
  const load = useCallback(() => {
    setError(null);
    shopCall<{ products: PublicProduct[] }>("products.list", {})
      .then((r) => setAll(r.products))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    document.title = `${cat ? CATEGORY_LABEL[cat] : "所有商品"}｜ATA Coffee`;
  }, [cat]);

  const list = useMemo(() => {
    let l = (all ?? []).filter((p) => !cat || p.category === cat);
    if (onlyAvail) l = l.filter((p) => p.state === "IN_STOCK" || p.state === "PREORDER");
    const price = (p: PublicProduct) => Number(p.minPrice ?? 0);
    if (sort === "price-asc") l = [...l].sort((a, b) => price(a) - price(b));
    if (sort === "price-desc") l = [...l].sort((a, b) => price(b) - price(a));
    if (sort === "new") l = [...l].reverse();
    // 售完、即將推出放最後
    const rank = (p: PublicProduct) => (p.state === "SOLD_OUT" ? 2 : p.state === "COMING_SOON" || p.state === "PREORDER_FULL" ? 1 : 0);
    return [...l].sort((a, b) => rank(a) - rank(b));
  }, [all, cat, sort, onlyAvail]);

  return (
    <div className="s-wrap pt-8 md:pt-12">
      <div className="flex items-center justify-between gap-4">
        <nav aria-label="商品分類" className="s-noscroll -mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0">
          {[null, "beans", "drip", "gift"].map((k) => (
            <Link key={k ?? "all"} href={k ? `/shop/products/?c=${k}` : "/shop/products/"} aria-current={cat === k ? "page" : undefined} className={`flex min-h-11 shrink-0 items-center px-3 text-[15px] tracking-wider ${cat === k ? "border-b border-[var(--s-fg)]" : "text-[var(--s-muted)]"}`}>
              {k ? CATEGORY_LABEL[k] : "全部"}
            </Link>
          ))}
        </nav>
        <button type="button" className="s-icon-btn shrink-0" aria-label="排序與篩選" aria-expanded={panel} onClick={() => setPanel(true)}>
          <SlidersHorizontal size={20} strokeWidth={1.5} />
        </button>
      </div>
      <div className="mt-8">
        {error ? (
          <ErrorBlock message={error} retry={load} />
        ) : !all ? (
          <SkeletonGrid n={8} />
        ) : list.length ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4">
            {list.map((p, i) => (
              <ProductCard key={p.id} p={p} onQuick={setQuick} priority={i < 4} />
            ))}
          </div>
        ) : (
          <p className="py-24 text-center text-sm text-[var(--s-muted)]">目前沒有商品</p>
        )}
      </div>
      {panel && (
        <Sheet title="排序與篩選" onClose={() => setPanel(false)}>
          <fieldset>
            <legend className="s-label">排序</legend>
            <div className="grid grid-cols-2 gap-2">
              {SORTS.map((s) => (
                <button key={s.key} type="button" className="s-chip" aria-pressed={sort === s.key} onClick={() => setSort(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="mt-6 flex min-h-11 items-center gap-3 text-[15px]">
            <input type="checkbox" className="h-5 w-5 accent-[var(--s-brand)]" checked={onlyAvail} onChange={(e) => setOnlyAvail(e.target.checked)} />
            只看可購買
          </label>
          <button type="button" className="s-btn mt-6 w-full" onClick={() => setPanel(false)}>
            顯示 {list.length} 件商品
          </button>
        </Sheet>
      )}
      {quick && <QuickAdd p={quick} onClose={() => setQuick(null)} />}
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <List />
    </Suspense>
  );
}
