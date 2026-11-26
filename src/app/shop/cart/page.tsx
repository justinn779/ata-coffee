"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { md, nt } from "@/lib/shop";
import { useShop } from "../_shell";
import { Summary, useQuote } from "../_cart";
import { Img, Mascot, Qty } from "../_ui";

export default function CartPage() {
  const { lines, setQty, remove } = useShop();
  const [coupon, setCoupon] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { data, error, loading } = useQuote(coupon);
  useEffect(() => {
    document.title = "購物袋｜ATA Coffee";
    try {
      const c = sessionStorage.getItem("ata-coupon");
      if (c) {
        setCoupon(c);
        setCode(c);
      }
    } catch {
      /* ignore */
    }
  }, []);
  const applyCoupon = (c: string | null) => {
    setCoupon(c);
    try {
      if (c) sessionStorage.setItem("ata-coupon", c);
      else sessionStorage.removeItem("ata-coupon");
    } catch {
      /* ignore */
    }
  };

  if (!lines.length)
    return (
      <div className="s-wrap flex flex-col items-center py-24 text-center">
        <Mascot name="ati" label="空購物袋" />
        <p className="mt-8 text-[15px] text-[var(--s-muted)]">購物袋是空的</p>
        <Link href="/shop/products/" className="s-btn mt-8">
          逛逛咖啡
        </Link>
      </div>
    );
  const q = data?.quote;
  const blocked = !!q?.issues.length || (q ? q.lines.some((l) => (data?.stock[l.key] ?? 0) < l.qty) : true);
  return (
    <div className="s-wrap pt-8 md:pt-12">
      <h1 className="serif text-2xl">購物袋</h1>
      <div className="mt-8 grid gap-12 md:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-label="商品">
          {error && <p className="mb-4 text-[14px] text-[var(--s-danger)]">{error}</p>}
          {q?.issues.map((i) => (
            <div key={i.key} className="mb-3 flex items-center justify-between gap-4 bg-[var(--s-bg-2)] px-4 py-3 text-[14px]">
              <span>{i.message}</span>
              <button type="button" className="shrink-0 underline underline-offset-4" onClick={() => remove(i.key)}>
                移除
              </button>
            </div>
          ))}
          <ul className="divide-y divide-[var(--s-line)] border-y border-[var(--s-line)]">
            {(q?.lines ?? []).map((l) => {
              const max = data?.stock[l.key] ?? l.qty;
              return (
                <li key={l.key} className="flex gap-4 py-5">
                  <Link href={`/shop/p/?s=${encodeURIComponent(l.slug)}`} className="shrink-0">
                    <Img src={l.image} alt={l.name} className="aspect-[4/5] w-20 md:w-24" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[15px]">{l.name}</p>
                        <p className="mt-0.5 text-[13px] text-[var(--s-muted)]">
                          {l.variantName}
                          {l.grind ? `・研磨：${l.grind.label}` : ""}
                          {l.mode === "PREORDER" ? `・預購 ${md(l.shipDate)} 出貨` : ""}
                        </p>
                        {l.bundle && <p className="mt-1 text-[12px] text-[var(--s-muted)]">{l.bundle.map((b) => `${b.name} ×${b.quantity}`).join("、")}</p>}
                      </div>
                      <button type="button" className="s-icon-btn -mr-3 -mt-3 shrink-0" aria-label={`移除 ${l.name}`} onClick={() => remove(l.key)}>
                        <X size={18} strokeWidth={1.5} />
                      </button>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <Qty value={l.qty} onChange={(n) => setQty(l.key, n)} max={Math.max(l.qty, max)} />
                      <span className="num text-[15px]">
                        {l.discount !== "0" && <s className="mr-2 text-[13px] text-[var(--s-muted)]">{nt(Number(l.unitPrice) * l.qty)}</s>}
                        {nt(l.lineTotal)}
                      </span>
                    </div>
                    {max < l.qty && <p className="mt-2 text-[13px] text-[var(--s-danger)]">{max > 0 ? `目前最多可買 ${max} 件` : "目前無法購買"}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          {!q && loading && <p className="py-8 text-center text-sm text-[var(--s-muted)]">計算中…</p>}
        </section>
        <aside aria-label="結帳摘要" className="md:sticky md:top-28 md:self-start">
          {q && (
            <Summary
              q={q}
              coupon={
                <form
                  className="flex gap-2 pt-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    applyCoupon(code.trim() || null);
                  }}
                >
                  <input className="s-input" placeholder="折扣碼" aria-label="折扣碼" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" />
                  <button type="submit" className="s-btn s-btn-line shrink-0 px-4">
                    套用
                  </button>
                </form>
              }
            />
          )}
          {q?.couponError && coupon && <p className="mt-2 text-[13px] text-[var(--s-danger)]">{q.couponError}</p>}
          <Link href="/shop/checkout/" aria-disabled={blocked} className={`s-btn mt-8 w-full ${blocked ? "pointer-events-none opacity-45" : ""}`}>
            前往結帳
          </Link>
        </aside>
      </div>
    </div>
  );
}
