"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { md, nt, shopCall, CATEGORY_LABEL, STATE_LABEL, type PublicProduct, type PublicVariant } from "@/lib/shop";
import { useShop } from "../_shell";
import { ErrorBlock, Img, Loading, Mascot, Price, Qty, StateText } from "../_ui";
import { GrindPicker } from "../_quick";

function Detail() {
  const slug = useSearchParams().get("s") ?? "";
  const { add, toast } = useShop();
  const [p, setP] = useState<PublicProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vid, setVid] = useState<string | null>(null);
  const [grind, setGrind] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [pick, setPick] = useState<Record<string, number>>({});
  const [img, setImg] = useState(0);

  const load = useCallback(() => {
    if (!slug) return setError("找不到這個商品");
    setError(null);
    shopCall<{ product: PublicProduct }>("product.get", { slug })
      .then((r) => {
        setP(r.product);
        const first = r.product.variants.find((v) => v.state === "IN_STOCK" || v.state === "PREORDER") ?? r.product.variants[0];
        setVid(first?.id ?? null);
      })
      .catch((e) => setError(e.message));
  }, [slug]);
  useEffect(load, [load]);

  // SEO：標題、描述與商品結構化資料
  useEffect(() => {
    if (!p) return;
    document.title = `${p.name}｜ATA Coffee`;
    const desc = [p.flavor, p.summary].filter(Boolean).join("。").slice(0, 150);
    let m = document.querySelector('meta[name="description"]');
    if (!m) {
      m = document.createElement("meta");
      m.setAttribute("name", "description");
      document.head.appendChild(m);
    }
    m.setAttribute("content", desc || p.name);
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: p.name,
      description: desc || undefined,
      image: p.images.map((i) => i.url),
      brand: { "@type": "Brand", name: "ATA Coffee" },
      offers: p.variants.map((v) => ({ "@type": "Offer", name: v.name, priceCurrency: "TWD", price: v.price, availability: v.state === "IN_STOCK" ? "https://schema.org/InStock" : v.state === "PREORDER" ? "https://schema.org/PreOrder" : "https://schema.org/OutOfStock", url: window.location.href })),
    });
    document.head.appendChild(ld);
    return () => ld.remove();
  }, [p]);

  const v = p?.variants.find((x) => x.id === vid) ?? null;
  const cb = v?.customBundle?.options ? v.customBundle : null;
  const picked = Object.values(pick).reduce((a, b) => a + b, 0);
  const bundleOk = !cb || (picked >= cb.min && picked <= cb.max);
  const bundlePrice = useMemo(() => {
    if (!cb || !v) return v?.price ?? null;
    if (cb.pricing !== "SUM_PLUS") return v.price;
    const sum = Object.entries(pick).reduce((t, [id, n]) => t + Number(cb.options!.find((o) => o.variantId === id)?.price ?? 0) * n, 0);
    return String(sum + Number(cb.extra ?? 0));
  }, [cb, v, pick]);

  if (error) return <ErrorBlock message={error} retry={slug ? load : undefined} />;
  if (!p) return <Loading />;
  const buyable = !!v && (v.state === "IN_STOCK" || v.state === "PREORDER") && bundleOk;
  const doAdd = () => {
    if (!v || !buyable) return;
    add({ variantId: v.id, qty, grind: p.grindable ? grind : null, bundle: cb ? Object.entries(pick).filter(([, n]) => n > 0).map(([variantId, n]) => ({ variantId, qty: n })) : null });
    toast("已加入購物袋");
    if (cb) setPick({});
  };
  const cta = !v ? "請選擇規格" : v.state === "SOLD_OUT" ? "已售完" : v.state === "PREORDER_FULL" ? "預購已額滿" : v.state === "COMING_SOON" ? "即將推出" : cb && !bundleOk ? `已選 ${picked}／${cb.max === cb.min ? cb.min : `${cb.min}–${cb.max}`}` : v.state === "PREORDER" ? "預購" : "加入購物袋";

  return (
    <div className="pb-28 md:pb-0">
      <div className="md:mx-auto md:grid md:max-w-[1200px] md:px-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-12 md:pt-10 lg:gap-20">
        {/* 圖片：手機左右滑動，桌面縮圖切換 */}
        <div>
          <div className="s-noscroll flex snap-x snap-mandatory overflow-x-auto md:hidden" onScroll={(e) => setImg(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
            {(p.images.length ? p.images : [{ url: "", alt: p.name }]).map((im, i) => (
              <Img key={i} src={im.url} alt={im.alt} className="aspect-[4/5] w-full shrink-0 snap-center" priority={i === 0} />
            ))}
          </div>
          {p.images.length > 1 && (
            <div className="mt-3 flex justify-center gap-1.5 md:hidden" aria-hidden>
              {p.images.map((_, i) => (
                <span key={i} className={`h-1 w-4 ${i === img ? "bg-[var(--s-fg)]" : "bg-[var(--s-line)]"}`} />
              ))}
            </div>
          )}
          <div className="hidden md:block">
            <Img src={p.images[img]?.url} alt={p.images[img]?.alt ?? p.name} className="aspect-[4/5] w-full" priority />
            {p.images.length > 1 && (
              <div className="mt-3 grid grid-cols-5 gap-3">
                {p.images.map((im, i) => (
                  <button key={i} type="button" aria-label={`第 ${i + 1} 張圖`} aria-pressed={i === img} className={`border ${i === img ? "border-[var(--s-fg)]" : "border-transparent"}`} onClick={() => setImg(i)}>
                    <Img src={im.url} alt="" className="aspect-[4/5] w-full" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-4 md:px-0">
          <nav aria-label="麵包屑" className="mt-6 text-[13px] text-[var(--s-muted)] md:mt-0">
            <Link href={`/shop/products/?c=${p.category}`}>{CATEGORY_LABEL[p.category]}</Link>
          </nav>
          <h1 className="serif mt-2 text-2xl leading-snug md:text-[28px]">{p.name}</h1>
          {p.flavor && <p className="mt-2 text-[15px] text-[var(--s-muted)]">{p.flavor}</p>}
          <p className="mt-4 text-xl">
            <Price value={bundlePrice} list={cb ? null : v?.listPrice} />
          </p>
          {v && (
            <p className="mt-1 h-5">
              {v.state === "IN_STOCK" ? (
                <span className="text-[13px] text-[var(--s-muted)]">
                  預計 {md(v.shipDate)} 出貨{v.lowStock ? <span className="ml-2 text-[var(--s-danger)]">剩 {v.lowStock} 件</span> : null}
                </span>
              ) : (
                <StateText v={v} />
              )}
            </p>
          )}

          {p.variants.length > 1 && (
            <div className="mt-6 flex flex-wrap gap-2" role="radiogroup" aria-label="規格">
              {p.variants.map((x) => (
                <button key={x.id} type="button" role="radio" aria-checked={vid === x.id} className="s-chip" onClick={() => setVid(x.id)}>
                  {x.name}
                  {x.state !== "IN_STOCK" && x.state !== "PREORDER" && <span className="ml-1 text-[12px] text-[var(--s-muted)]">{STATE_LABEL[x.state]}</span>}
                </button>
              ))}
            </div>
          )}

          {v?.bundle && (
            <ul className="mt-6 space-y-1 text-[14px] text-[var(--s-muted)]">
              {v.bundle.map((b, i) => (
                <li key={i}>
                  {b.name} × {b.quantity}
                </li>
              ))}
            </ul>
          )}

          {cb && v && <BundleBuilder v={v} pick={pick} setPick={setPick} picked={picked} />}

          {p.grindable && !cb && (
            <div className="mt-6">
              <GrindPicker value={grind} onChange={setGrind} />
            </div>
          )}

          {v?.state === "SOLD_OUT" && (
            <div className="mt-8 flex items-center gap-4">
              <Mascot name="ato" label="售完" />
              <p className="text-[14px] text-[var(--s-muted)]">這一批已經售完，下一批烘焙後會再上架。</p>
            </div>
          )}

          <div className="mt-6 hidden items-center gap-3 md:flex">
            {!cb && <Qty value={qty} onChange={setQty} max={Math.max(1, v?.maxQty ?? 1)} />}
            <button type="button" className="s-btn flex-1" disabled={!buyable} onClick={doAdd}>
              {cta}
            </button>
          </div>

          <div className="mt-10 border-t border-[var(--s-line)]">
            {p.summary && <Fold title="商品介紹" body={p.summary} open />}
            {p.details.map((d, i) => (
              <Fold key={i} title={d.title} body={d.body} />
            ))}
            <Fold title="運送與付款" body={"超商取貨（7-ELEVEN、全家），銀行轉帳付款。\n現貨與預購一起下單時，會在預購商品到貨後一起出貨。"} />
          </div>
        </div>
      </div>

      {/* 手機固定底部購買列 */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--s-line)] bg-[var(--s-bg)] px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 md:hidden">
        <div className="flex items-center gap-3">
          {!cb && <Qty value={qty} onChange={setQty} max={Math.max(1, v?.maxQty ?? 1)} />}
          <button type="button" className="s-btn flex-1" disabled={!buyable} onClick={doAdd}>
            {cta}
          </button>
        </div>
      </div>
    </div>
  );
}

function Fold({ title, body, open }: { title: string; body: string; open?: boolean }) {
  return (
    <details className="group border-b border-[var(--s-line)]" open={open}>
      <summary className="flex min-h-14 items-center justify-between text-[15px]">
        {title}
        <ChevronDown size={18} strokeWidth={1.5} className="transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <p className="whitespace-pre-line pb-5 text-[14px] leading-relaxed text-[var(--s-muted)]">{body}</p>
    </details>
  );
}

/** 自選禮盒：選擇商品與數量，顯示進度 */
function BundleBuilder({ v, pick, setPick, picked }: { v: PublicVariant; pick: Record<string, number>; setPick: (p: Record<string, number>) => void; picked: number }) {
  const cb = v.customBundle!;
  const full = picked >= cb.max;
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between text-[14px]">
        <span>挑選內容</span>
        <span className="num text-[var(--s-muted)]" aria-live="polite">
          {picked} / {cb.max === cb.min ? cb.max : `${cb.min}–${cb.max}`}
        </span>
      </div>
      <div className="mt-2 h-[2px] bg-[var(--s-line)]" aria-hidden>
        <div className="h-full bg-[var(--s-brand)] transition-all" style={{ width: `${Math.min(100, (picked / cb.max) * 100)}%` }} />
      </div>
      <ul className="mt-4 divide-y divide-[var(--s-line)]">
        {cb.options!.map((o) => {
          const n = pick[o.variantId] ?? 0;
          const maxHere = cb.allowRepeat ? o.available : 1;
          return (
            <li key={o.variantId} className="flex items-center gap-3 py-3">
              <Img src={o.image} alt={o.name} className="h-16 w-[52px] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px]">{o.name}</p>
                <p className="text-[13px] text-[var(--s-muted)]">{o.soldOut ? "售完" : cb.pricing === "SUM_PLUS" ? nt(o.price) : ""}</p>
              </div>
              <div className="flex items-center">
                <button type="button" className="s-icon-btn" aria-label={`減少 ${o.name}`} disabled={n <= 0} onClick={() => setPick({ ...pick, [o.variantId]: n - 1 })}>
                  <Minus size={16} strokeWidth={1.5} />
                </button>
                <span className="num w-6 text-center">{n}</span>
                <button type="button" className="s-icon-btn" aria-label={`增加 ${o.name}`} disabled={o.soldOut || full || n >= maxHere} onClick={() => setPick({ ...pick, [o.variantId]: n + 1 })}>
                  <Plus size={16} strokeWidth={1.5} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ProductPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Detail />
    </Suspense>
  );
}
