"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { shopCall, CATEGORY_LABEL, type PublicProduct } from "@/lib/shop";
import { ErrorBlock, Img, ProductCard, SkeletonGrid } from "./_ui";
import { QuickAdd } from "./_quick";

type Section =
  | { id: string; type: "HERO" | "EVENT"; title: string | null; text: string | null; imageDesktop: string | null; imageMobile: string | null; imageAlt: string; link: string | null; linkLabel: string | null }
  | { id: string; type: "FEATURED"; title: string | null; products: PublicProduct[] }
  | { id: string; type: "CATEGORIES"; title: string | null; categories: Array<{ key: string; count: number; image: string | null }> };

export function Home() {
  const preview = useSearchParams().get("preview") === "1";
  const [data, setData] = useState<{ sections: Section[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quick, setQuick] = useState<PublicProduct | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      // 後台預覽：管理員看到草稿內容
      if (preview) {
        const { callOp } = await import("@/lib/api");
        const r = await callOp<{ sections: Section[] }>("store.content.preview", { page: null });
        if (r.ok) return setData(r.data as { sections: Section[] });
      }
      setData(await shopCall<{ sections: Section[] }>("home"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [preview]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorBlock message={error} retry={load} />;
  if (!data)
    return (
      <div>
        <div className="aspect-[4/5] w-full bg-[var(--s-bg-2)] md:aspect-[21/9]" />
        <div className="s-wrap mt-16">
          <SkeletonGrid />
        </div>
      </div>
    );
  return (
    <>
      {preview && <p className="bg-[var(--s-bg-2)] py-2 text-center text-[13px]">預覽草稿內容（只有管理員看得到）</p>}
      {data.sections.map((s, i) => {
        if (s.type === "HERO") return <Hero key={s.id} s={s} first={i === 0} />;
        if (s.type === "EVENT") return <Event key={s.id} s={s} />;
        if (s.type === "FEATURED")
          return (
            <section key={s.id} className="s-wrap mt-16 md:mt-24" aria-label={s.title ?? "本期選集"}>
              {s.title && <h2 className="serif mb-8 text-xl md:text-2xl">{s.title}</h2>}
              <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4">
                {s.products.slice(0, 8).map((p) => (
                  <ProductCard key={p.id} p={p} onQuick={setQuick} />
                ))}
              </div>
            </section>
          );
        if (s.type === "CATEGORIES")
          return (
            <section key={s.id} className="s-wrap mt-16 md:mt-24" aria-label={s.title ?? "商品分類"}>
              {s.title && <h2 className="serif mb-8 text-xl md:text-2xl">{s.title}</h2>}
              <div className="grid grid-cols-3 gap-3 md:gap-6">
                {s.categories.map((c) => (
                  <Link key={c.key} href={`/shop/products/?c=${c.key}`} className="group block">
                    <Img src={c.image} alt={CATEGORY_LABEL[c.key]} className="aspect-[3/4] w-full" />
                    <span className="mt-3 flex items-center justify-between text-[15px] tracking-wider">
                      {CATEGORY_LABEL[c.key]}
                      <ArrowRight size={16} strokeWidth={1.5} className="hidden transition-transform group-hover:translate-x-1 md:block" />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          );
        return null;
      })}
      {quick && <QuickAdd p={quick} onClose={() => setQuick(null)} />}
    </>
  );
}

type Banner = Extract<Section, { type: "HERO" | "EVENT" }>;

function Hero({ s, first }: { s: Banner; first: boolean }) {
  // 沒有圖片時只顯示文字（不在空白底上放白字）
  if (!s.imageDesktop && !s.imageMobile)
    return (
      <section className="s-wrap pt-16 md:pt-24" aria-label={s.title ?? "主視覺"}>
        {s.title && <h1 className="serif max-w-xl text-[28px] leading-snug md:text-4xl">{s.title}</h1>}
        {s.text && <p className="mt-3 max-w-md text-[15px] text-[var(--s-muted)]">{s.text}</p>}
        {s.link && (
          <Link href={s.link} className="s-btn mt-6">
            {s.linkLabel || "選購"}
          </Link>
        )}
      </section>
    );
  return (
    <section className="relative" aria-label={s.title ?? "主視覺"}>
      <picture>
        {s.imageDesktop && <source media="(min-width: 768px)" srcSet={s.imageDesktop} />}
        <Img src={s.imageMobile ?? s.imageDesktop} alt={s.imageAlt} className="aspect-[4/5] w-full md:aspect-[21/9]" priority={first} />
      </picture>
      {(s.title || s.link) && (
        <div className="s-wrap absolute inset-x-0 bottom-10 md:bottom-16">
          {s.title && <h1 className="serif max-w-md text-[28px] leading-snug text-white [text-shadow:0_1px_12px_rgba(0,0,0,.25)] md:text-4xl">{s.title}</h1>}
          {s.text && <p className="mt-3 max-w-md text-[15px] text-white/90 [text-shadow:0_1px_8px_rgba(0,0,0,.25)]">{s.text}</p>}
          {s.link && (
            <Link href={s.link} className="s-btn s-btn-light mt-6">
              {s.linkLabel || "選購"}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

function Event({ s }: { s: Banner }) {
  const body = (
    <>
      <picture>
        {s.imageDesktop && <source media="(min-width: 768px)" srcSet={s.imageDesktop} />}
        <Img src={s.imageMobile ?? s.imageDesktop} alt={s.imageAlt} className="aspect-[4/3] w-full md:aspect-[3/1]" />
      </picture>
      {(s.title || s.text) && (
        <div className="mt-4 flex items-end justify-between gap-4">
          <div>
            {s.title && <h2 className="serif text-lg md:text-xl">{s.title}</h2>}
            {s.text && <p className="mt-1 text-[14px] text-[var(--s-muted)]">{s.text}</p>}
          </div>
          {s.link && <ArrowRight size={18} strokeWidth={1.5} aria-hidden />}
        </div>
      )}
    </>
  );
  return (
    <section className="s-wrap mt-16 md:mt-24" aria-label={s.title ?? "活動"}>
      {s.link ? (
        <Link href={s.link} className="block">
          {body}
        </Link>
      ) : (
        body
      )}
    </section>
  );
}
