"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { ChevronRight, X } from "lucide-react";
import { shopFb } from "@/lib/firebase-lite";
import { lineStartUrl, nt, shopCall, twDateTime } from "@/lib/shop";
import { useShop } from "../_shell";
import { Field, Img, Loading } from "../_ui";

interface Profile {
  uid: string;
  email: string | null;
  name: string;
  phone: string;
  contactEmail: string;
  savedStores: Array<{ carrier: string; carrierLabel: string; storeId: string; storeName: string }>;
  providers: string[];
}
interface OrderRow {
  id: string;
  orderNo: string;
  createdAt: string;
  headline: string;
  total: string;
  itemCount: number;
  image: string | null;
}

export default function AccountPage() {
  const router = useRouter();
  const { user, authReady, toast } = useShop();
  const [p, setP] = useState<Profile | null>(null);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", contactEmail: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [me, os] = await Promise.all([shopCall<{ profile: Profile }>("account.me"), shopCall<{ orders: OrderRow[] }>("account.orders")]);
    setP(me.profile);
    setForm({ name: me.profile.name, phone: me.profile.phone, contactEmail: me.profile.contactEmail });
    setOrders(os.orders);
  }, []);
  useEffect(() => {
    document.title = "會員中心｜ATA Coffee";
  }, []);
  useEffect(() => {
    if (!authReady) return;
    if (!user) router.replace("/shop/login/?return=/shop/account/");
    else load().catch((e) => toast(e.message));
  }, [authReady, user, router, load, toast]);

  if (!p) return <Loading />;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await shopCall("account.update", form);
      setErr({});
      toast("已儲存");
    } catch (ex) {
      const fe = (ex as { fieldErrors?: Record<string, string> }).fieldErrors;
      setErr(fe ?? { name: (ex as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const linkLine = async () => {
    const r = await shopCall<{ link: string }>("auth.lineLinkStart");
    window.location.href = lineStartUrl("/shop/account/", r.link);
  };

  return (
    <div className="s-wrap pt-10 md:pt-16">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-baseline justify-between">
          <h1 className="serif text-2xl">會員中心</h1>
          <button
            type="button"
            className="min-h-11 text-[14px] underline underline-offset-4"
            onClick={async () => {
              await signOut(shopFb().auth);
              router.replace("/shop/");
            }}
          >
            登出
          </button>
        </div>

        <section className="mt-10" aria-labelledby="h-orders">
          <h2 id="h-orders" className="mb-4 text-[15px]">
            我的訂單
          </h2>
          {orders && orders.length ? (
            <ul className="divide-y divide-[var(--s-line)] border-y border-[var(--s-line)]">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link href={`/shop/order/?id=${encodeURIComponent(o.id)}`} className="flex items-center gap-4 py-4">
                    <Img src={o.image} alt="" className="aspect-[4/5] w-12 shrink-0" />
                    <div className="min-w-0 flex-1 text-[14px]">
                      <p>{o.headline}</p>
                      <p className="num text-[12px] text-[var(--s-muted)]">
                        {o.orderNo}・{twDateTime(o.createdAt)}・{o.itemCount} 件
                      </p>
                    </div>
                    <span className="num text-[14px]">{nt(o.total)}</span>
                    <ChevronRight size={18} strokeWidth={1.5} aria-hidden className="text-[var(--s-muted)]" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-[var(--s-muted)]">還沒有訂單。</p>
          )}
          <Link href="/shop/lookup/" className="mt-3 inline-flex min-h-11 items-center text-[13px] text-[var(--s-muted)] underline underline-offset-4">
            以前用訪客身分下的訂單？驗證後加入帳號
          </Link>
        </section>

        <section className="mt-12" aria-labelledby="h-profile">
          <h2 id="h-profile" className="mb-4 text-[15px]">
            基本資料
          </h2>
          <form onSubmit={save} className="space-y-4">
            <Field label="姓名" error={err.name}>
              <input className="s-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="手機" error={err.phone}>
                <input className="s-input num" inputMode="numeric" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} />
              </Field>
              <Field label="通知 Email" error={err.contactEmail}>
                <input className="s-input" type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
              </Field>
            </div>
            <button type="submit" className="s-btn s-btn-line" disabled={busy}>
              儲存
            </button>
          </form>
        </section>

        <section className="mt-12" aria-labelledby="h-stores">
          <h2 id="h-stores" className="mb-4 text-[15px]">
            常用取貨門市
          </h2>
          {p.savedStores.length ? (
            <ul className="divide-y divide-[var(--s-line)] border-y border-[var(--s-line)]">
              {p.savedStores.map((s) => (
                <li key={`${s.carrier}-${s.storeId}`} className="flex items-center justify-between py-2 text-[14px]">
                  <span>
                    {s.carrierLabel} {s.storeName}（<span className="num">{s.storeId}</span>）
                  </span>
                  <button
                    type="button"
                    className="s-icon-btn -mr-3"
                    aria-label={`移除 ${s.storeName}`}
                    onClick={async () => {
                      await shopCall("account.removeStore", { carrier: s.carrier, storeId: s.storeId });
                      await load();
                    }}
                  >
                    <X size={18} strokeWidth={1.5} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-[var(--s-muted)]">結帳時勾選「記住收件資料與門市」就會出現在這裡。</p>
          )}
        </section>

        <section className="mt-12" aria-labelledby="h-login">
          <h2 id="h-login" className="mb-4 text-[15px]">
            登入方式
          </h2>
          <p className="text-[14px] text-[var(--s-muted)]">{p.email ?? "—"}</p>
          {!p.providers.includes("line") && (
            <button type="button" className="s-btn s-btn-line mt-4" onClick={() => linkLine().catch((e) => toast(e.message))}>
              綁定 LINE
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
