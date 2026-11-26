"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { md, nt, shopCall, ShopCallError, type Quote } from "@/lib/shop";
import { useShop } from "../_shell";
import { Field, Img } from "../_ui";
import { Summary, useQuote } from "../_cart";

type SavedStore = { carrier: "SEVEN" | "FAMILY"; carrierLabel: string; storeId: string; storeName: string; storeAddress?: string | null };
const STORE_LOOKUP: Record<string, string> = { SEVEN: "https://emap.pcsc.com.tw/", FAMILY: "https://www.family.com.tw/Marketing/zh/Map" };

function idemKey() {
  try {
    let k = sessionStorage.getItem("ata-idem");
    if (!k) {
      k = crypto.randomUUID();
      sessionStorage.setItem("ata-idem", k);
    }
    return k;
  } catch {
    return crypto.randomUUID();
  }
}

export default function CheckoutPage() {
  const router = useRouter();
  const { lines, settings, user, clear } = useShop();
  const [coupon, setCoupon] = useState<string | null>(null);
  useEffect(() => {
    document.title = "結帳｜ATA Coffee";
    try {
      setCoupon(sessionStorage.getItem("ata-coupon"));
    } catch {
      /* ignore */
    }
  }, []);
  const { data, error: quoteError } = useQuote(coupon);
  const [f, setF] = useState({ name: "", phone: "", email: "", carrier: "SEVEN" as "SEVEN" | "FAMILY", storeId: "", storeName: "", note: "", agree: false, saveProfile: true });
  const [saved, setSaved] = useState<SavedStore[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [changed, setChanged] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  // 會員帶入常用資料
  useEffect(() => {
    if (!user) return;
    shopCall<{ profile: { name: string; phone: string; contactEmail: string; savedStores: SavedStore[] } }>("account.me")
      .then(({ profile: p }) => {
        setSaved(p.savedStores ?? []);
        const s0 = p.savedStores?.[0];
        setF((x) => ({ ...x, name: x.name || p.name, phone: x.phone || p.phone, email: x.email || p.contactEmail || user.email || "", ...(s0 && !x.storeId ? { carrier: s0.carrier, storeId: s0.storeId, storeName: s0.storeName } : {}) }));
      })
      .catch(() => undefined);
  }, [user]);

  if (!lines.length)
    return (
      <div className="s-wrap py-24 text-center">
        <p className="text-[15px] text-[var(--s-muted)]">購物袋是空的</p>
        <Link href="/shop/products/" className="s-btn mt-8">
          逛逛咖啡
        </Link>
      </div>
    );
  const q = changed ?? data?.quote ?? null;
  const channels = settings?.pickupChannels ?? [
    { key: "SEVEN" as const, label: "7-ELEVEN" },
    { key: "FAMILY" as const, label: "全家" },
  ];

  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = "請填寫收件人姓名";
    if (!/^09\d{8}$/.test(f.phone.trim())) e.phone = "手機號碼格式：09 開頭共 10 碼";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = "Email 格式不正確";
    if (!/^\d{6}$/.test(f.storeId.trim())) e.storeId = "店號是 6 位數字";
    if (!f.storeName.trim()) e.storeName = "請填寫門市名稱";
    if (!f.agree) e.agree = "請先閱讀並同意";
    setErrors(e);
    return !Object.keys(e).length;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy || !q || !validate()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await shopCall<{ token: string; orderId: string }>("order.create", {
        lines,
        couponCode: coupon,
        contact: { name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() },
        pickup: { carrier: f.carrier, storeId: f.storeId.trim(), storeName: f.storeName.trim() },
        note: f.note.trim() || null,
        agree: true,
        signature: q.signature,
        idempotencyKey: idemKey(),
        saveProfile: !!user && f.saveProfile,
      });
      try {
        sessionStorage.removeItem("ata-idem");
        sessionStorage.removeItem("ata-coupon");
      } catch {
        /* ignore */
      }
      clear();
      router.replace(`/shop/order/?t=${encodeURIComponent(r.token)}&new=1`);
    } catch (e) {
      const err = e as ShopCallError;
      if (err.code === "PRICE_CHANGED" && err.data?.quote) {
        setChanged(err.data.quote as Quote);
        setMsg("價格、優惠或出貨日有更新，請確認新的金額後再送出。");
      } else if (err.fieldErrors) {
        setErrors(Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k.split(".").pop()!, v])));
        setMsg(err.message);
      } else setMsg(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="s-wrap pt-8 md:pt-12">
      <h1 className="serif text-2xl">結帳</h1>
      {!user && (
        <p className="mt-3 text-[14px] text-[var(--s-muted)]">
          不需要註冊也能購買。
          <Link href="/shop/login/?return=/shop/checkout/" className="ml-1 underline underline-offset-4">
            登入
          </Link>
          可帶入常用資料。
        </p>
      )}
      <form onSubmit={submit} noValidate className="mt-8 grid gap-12 md:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-10">
          <fieldset className="space-y-4">
            <legend className="mb-4 text-[15px]">收件人</legend>
            <Field label="姓名（與證件相同，取貨需核對）" error={errors.name}>
              <input className="s-input" autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} maxLength={40} />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="手機" error={errors.phone}>
                <input className="s-input num" inputMode="numeric" autoComplete="tel" value={f.phone} onChange={(e) => set("phone", e.target.value.replace(/\D/g, "").slice(0, 10))} aria-invalid={!!errors.phone} placeholder="0912345678" />
              </Field>
              <Field label="Email（訂單通知）" error={errors.email}>
                <input className="s-input" type="email" autoComplete="email" value={f.email} onChange={(e) => set("email", e.target.value)} aria-invalid={!!errors.email} />
              </Field>
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="mb-4 text-[15px]">超商取貨</legend>
            <div className="flex gap-2" role="radiogroup" aria-label="超商">
              {channels.map((c) => (
                <button key={c.key} type="button" role="radio" aria-checked={f.carrier === c.key} className="s-chip flex-1" onClick={() => set("carrier", c.key)}>
                  {c.label}
                </button>
              ))}
            </div>
            {saved.filter((s) => s.carrier === f.carrier).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {saved
                  .filter((s) => s.carrier === f.carrier)
                  .map((s) => (
                    <button key={s.storeId} type="button" className="s-chip" aria-pressed={f.storeId === s.storeId} onClick={() => setF((x) => ({ ...x, storeId: s.storeId, storeName: s.storeName }))}>
                      {s.storeName}
                    </button>
                  ))}
              </div>
            )}
            <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
              <Field label="店號" error={errors.storeId}>
                <input className="s-input num" inputMode="numeric" value={f.storeId} onChange={(e) => set("storeId", e.target.value.replace(/\D/g, "").slice(0, 6))} aria-invalid={!!errors.storeId} placeholder="6 碼" />
              </Field>
              <Field label="門市名稱" error={errors.storeName}>
                <input className="s-input" value={f.storeName} onChange={(e) => set("storeName", e.target.value)} aria-invalid={!!errors.storeName} maxLength={40} placeholder="例：信義" />
              </Field>
            </div>
            <a href={STORE_LOOKUP[f.carrier]} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-[14px] underline underline-offset-4">
              查詢{channels.find((c) => c.key === f.carrier)?.label}門市店號
              <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
            </a>
          </fieldset>

          <Field label="備註（選填）" error={errors.note}>
            <textarea className="s-input" value={f.note} onChange={(e) => set("note", e.target.value)} maxLength={300} />
          </Field>

          <div className="space-y-3">
            {user && (
              <label className="flex min-h-11 items-center gap-3 text-[14px]">
                <input type="checkbox" className="h-5 w-5 accent-[var(--s-brand)]" checked={f.saveProfile} onChange={(e) => set("saveProfile", e.target.checked)} />
                記住收件資料與門市
              </label>
            )}
            <label className="flex min-h-11 items-start gap-3 text-[14px] leading-relaxed">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--s-brand)]" checked={f.agree} onChange={(e) => set("agree", e.target.checked)} aria-invalid={!!errors.agree} />
              <span>
                我已閱讀並同意
                <Link href="/shop/page/?k=guide" target="_blank" className="mx-1 underline underline-offset-4">
                  購物須知
                </Link>
                、
                <Link href="/shop/page/?k=returns" target="_blank" className="mx-1 underline underline-offset-4">
                  退換貨
                </Link>
                與
                <Link href="/shop/page/?k=privacy" target="_blank" className="mx-1 underline underline-offset-4">
                  隱私權政策
                </Link>
              </span>
            </label>
            {errors.agree && <p className="text-[13px] text-[var(--s-danger)]">{errors.agree}</p>}
          </div>
        </div>

        <aside aria-label="訂單摘要" className="md:sticky md:top-28 md:self-start">
          {q ? (
            <>
              <ul className="mb-6 space-y-4 border-b border-[var(--s-line)] pb-6">
                {q.lines.map((l) => (
                  <li key={l.key} className="flex gap-3 text-[14px]">
                    <Img src={l.image} alt={l.name} className="aspect-[4/5] w-14 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{l.name}</p>
                      <p className="text-[12px] text-[var(--s-muted)]">
                        {l.variantName}
                        {l.grind ? `・${l.grind.label}` : ""}
                        {l.mode === "PREORDER" ? `・預購 ${md(l.shipDate)}` : ""} × {l.qty}
                      </p>
                    </div>
                    <span className="num">{nt(l.lineTotal)}</span>
                  </li>
                ))}
              </ul>
              <Summary q={q} />
              <p className="mt-4 text-[13px] text-[var(--s-muted)]">付款方式：銀行轉帳（下單後 {settings?.paymentDeadlineHours ?? 72} 小時內）</p>
            </>
          ) : (
            <p className="text-sm text-[var(--s-muted)]">{quoteError ?? "計算中…"}</p>
          )}
          {q?.issues.length ? (
            <p className="mt-4 text-[13px] text-[var(--s-danger)]">
              購物袋有商品無法購買，請先回到
              <Link href="/shop/cart/" className="mx-1 underline">
                購物袋
              </Link>
              調整。
            </p>
          ) : null}
          {msg && (
            <p className="mt-4 bg-[var(--s-bg-2)] px-4 py-3 text-[14px]" role="alert">
              {msg}
            </p>
          )}
          <button type="submit" className="s-btn mt-6 w-full" disabled={busy || !q || !!q.issues.length}>
            {busy ? "送出中…" : changed ? `確認新金額 ${nt(q?.total)} 並送出` : "送出訂單"}
          </button>
          {settings?.demo.bank && <p className="mt-3 text-center text-[12px] text-[var(--s-danger)]">測試環境：收款帳戶為示範資料</p>}
        </aside>
      </form>
    </div>
  );
}
