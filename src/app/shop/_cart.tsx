"use client";

import { useEffect, useState } from "react";
import { md, nt, shopCall, type Quote } from "@/lib/shop";
import { useShop } from "./_shell";

export function useQuote(coupon: string | null) {
  const { lines, user } = useShop();
  const [q, setQ] = useState<{ quote: Quote; stock: Record<string, number> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sig = JSON.stringify(lines) + (coupon ?? "") + (user?.uid ?? "");
  useEffect(() => {
    if (!lines.length) return setQ(null);
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      shopCall<{ quote: Quote; stock: Record<string, number> }>("cart.quote", { lines, couponCode: coupon })
        .then((r) => live && (setQ(r), setError(null)))
        .catch((e) => live && setError(e.message))
        .finally(() => live && setLoading(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data: q, error, loading };
}

export function Summary({ q, coupon }: { q: Quote; coupon?: React.ReactNode }) {
  return (
    <dl className="space-y-3 text-[15px]">
      <div className="flex justify-between">
        <dt>商品小計</dt>
        <dd className="num">{nt(q.itemsGross)}</dd>
      </div>
      {q.promotions.map((p) => (
        <div key={p.id} className="flex justify-between text-[var(--s-brand)]">
          <dt>{p.name}</dt>
          <dd className="num">−{nt(p.amount)}</dd>
        </div>
      ))}
      {coupon}
      <div className="flex justify-between">
        <dt>運費</dt>
        <dd className="num">{q.shippingFee === "0" ? "免運" : nt(q.shippingFee)}</dd>
      </div>
      {q.freeShippingRemaining && <p className="text-[13px] text-[var(--s-muted)]">再買 {nt(q.freeShippingRemaining)} 免運</p>}
      <div className="flex justify-between border-t border-[var(--s-line)] pt-4 text-lg">
        <dt>總計</dt>
        <dd className="num">{nt(q.total)}</dd>
      </div>
      <p className="text-[13px] text-[var(--s-muted)]">
        預計 {md(q.estShipDate)} 出貨{q.hasPreorder ? "・含預購商品，到貨後一起出貨" : ""}
      </p>
    </dl>
  );
}

