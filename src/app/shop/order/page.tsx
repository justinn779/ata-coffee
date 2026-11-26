"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { md, nt, shopCall, twDateTime } from "@/lib/shop";
import { useShop } from "../_shell";
import { CopyBtn, Field, Img, Loading, Mascot, Sheet } from "../_ui";

interface OrderView {
  id: string;
  orderNo: string;
  createdAt: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  headline: string;
  steps: Array<{ key: string; label: string; done: boolean }>;
  items: Array<{ name: string; image: string | null; qty: number; unitPrice: string; lineTotal: string; grind: string | null; preorder: boolean; bundle: Array<{ name: string; quantity: number }> | null }>;
  itemsGross: string;
  discount: string;
  promotions: Array<{ name: string; amount: string }>;
  shippingFee: string;
  total: string;
  refunded: string;
  estShipDate: string | null;
  originalEstShipDate: string | null;
  pickup: { carrierLabel: string; storeId: string; storeName: string };
  contact: { name: string; phone: string; email: string };
  payment: null | { deadline: string; amount: string; bank: { bankName: string; bankCode: string; branch: string; accountNo: string; accountName: string; isDemo: boolean } };
  lastReport: null | { last5: string; at: string; status: string; reason: string | null };
  shipment: null | { carrier: string | null; trackingNo: string | null; shippedAt: string | null };
  canCancel: boolean;
  canReport: boolean;
}

function OrderPage() {
  const sp = useSearchParams();
  const token = sp.get("t");
  const id = sp.get("id");
  const isNew = sp.get("new") === "1";
  const { user, authReady, settings } = useShop();
  const [o, setO] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last5, setLast5] = useState("");
  const [rep, setRep] = useState<{ busy: boolean; error: string | null; done: boolean }>({ busy: false, error: null, done: false });
  const [askCancel, setAskCancel] = useState(false);

  const load = useCallback(async () => {
    if (!token && !id) return setError("找不到訂單");
    if (!token && !authReady) return;
    try {
      setO((await shopCall<{ order: OrderView }>("order.get", { token, orderId: id })).order);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token, id, authReady, user]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    document.title = "訂單｜ATA Coffee";
  }, []);

  if (error)
    return (
      <div className="s-wrap py-24 text-center">
        <p className="text-sm text-[var(--s-muted)]">{error}</p>
        <Link href="/shop/lookup/" className="s-btn s-btn-line mt-8">
          用訂單編號查詢
        </Link>
      </div>
    );
  if (!o) return <Loading />;

  const report = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{5}$/.test(last5)) return setRep({ busy: false, error: "請輸入 5 位數字", done: false });
    setRep({ busy: true, error: null, done: false });
    try {
      await shopCall("order.reportPayment", { token, orderId: id, last5 });
      setRep({ busy: false, error: null, done: true });
      setLast5("");
      await load();
    } catch (err) {
      setRep({ busy: false, error: (err as Error).message, done: false });
    }
  };
  const cancel = async () => {
    try {
      await shopCall("order.cancel", { token, orderId: id });
      setAskCancel(false);
      await load();
    } catch (err) {
      setAskCancel(false);
      setError((err as Error).message);
    }
  };
  const reviewing = o.paymentStatus === "PENDING_CONFIRMATION" || o.paymentStatus === "UNDER_REVIEW";
  const cancelled = o.fulfillmentStatus === "CANCELLED";
  const b = o.payment?.bank;

  return (
    <div className="s-wrap pt-10 md:pt-16">
      <div className="mx-auto max-w-2xl">
      {isNew && !cancelled ? (
        <div className="mb-12 flex flex-col items-center text-center">
          <Mascot name="ati" label="訂單成立" />
          <h1 className="serif mt-6 text-2xl">謝謝你的訂購</h1>
          <p className="mt-2 text-[14px] text-[var(--s-muted)]">訂單確認信已寄到你的 Email，也可以把這個頁面加入書籤。</p>
        </div>
      ) : (
        <h1 className="serif text-2xl">{o.headline}</h1>
      )}

      <div className="flex items-baseline justify-between border-b border-[var(--s-line)] pb-4 text-[14px]">
        <span>
          訂單 <span className="num">{o.orderNo}</span>
        </span>
        <span className="text-[var(--s-muted)]">{twDateTime(o.createdAt)}</span>
      </div>

      {/* 進度 */}
      {!cancelled && (
        <ol className="mt-8 grid grid-cols-6 gap-1" aria-label="訂單進度">
          {o.steps.map((s) => (
            <li key={s.key} className="text-center">
              <span className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full border ${s.done ? "border-[var(--s-brand)] bg-[var(--s-brand)] text-[var(--s-bg)]" : "border-[var(--s-line)]"}`} aria-hidden>
                {s.done && <Check size={14} strokeWidth={2} />}
              </span>
              <span className={`mt-2 block text-[11px] leading-tight md:text-[12px] ${s.done ? "" : "text-[var(--s-muted)]"}`}>
                {s.label}
                <span className="sr-only">{s.done ? "（已完成）" : "（尚未）"}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {/* 付款資訊 */}
      {o.payment && b && (
        <section className="mt-10 bg-[var(--s-bg-2)] px-5 py-6" aria-label="付款資訊">
          {o.paymentStatus === "REJECTED" && <p className="mb-4 text-[14px] text-[var(--s-danger)]">付款資訊需要確認{o.lastReport?.reason ? `：${o.lastReport.reason}` : ""}，請確認後重新回報。</p>}
          <dl className="space-y-3 text-[15px]">
            <Row k="應付金額" v={nt(o.payment.amount)} copy={o.payment.amount} strong />
            <Row k="銀行" v={`${b.bankName}${b.branch ? ` ${b.branch}` : ""}`} />
            <Row k="銀行代碼" v={b.bankCode} copy={b.bankCode} />
            <Row k="帳號" v={b.accountNo} copy={b.accountNo} />
            <Row k="戶名" v={b.accountName} />
            <Row k="付款期限" v={twDateTime(o.payment.deadline)} />
          </dl>
          {b.isDemo && <p className="mt-4 text-[12px] text-[var(--s-danger)]">測試環境：這是示範帳戶，請勿匯款。</p>}
        </section>
      )}

      {o.canReport && !cancelled && (
        <section className="mt-8" aria-label="付款回報">
          {reviewing && o.lastReport ? (
            <p className="text-[14px] text-[var(--s-muted)]">
              已收到付款回報（帳號末五碼 <span className="num">{o.lastReport.last5}</span>），確認款項後會通知你。
            </p>
          ) : (
            <form onSubmit={report} className="flex items-end gap-3">
              <div className="flex-1">
                <Field label="完成轉帳後，回報你的帳號末五碼" error={rep.error}>
                  <input className="s-input num tracking-[0.3em]" inputMode="numeric" autoComplete="off" value={last5} onChange={(e) => setLast5(e.target.value.replace(/\D/g, "").slice(0, 5))} aria-invalid={!!rep.error} placeholder="00000" />
                </Field>
              </div>
              <button type="submit" className="s-btn shrink-0" disabled={rep.busy || last5.length !== 5}>
                回報
              </button>
            </form>
          )}
          {rep.done && <p className="mt-2 text-[13px] text-[var(--s-ok)]">已回報，謝謝！</p>}
        </section>
      )}

      {o.estShipDate && !cancelled && !o.shipment && (
        <p className="mt-8 text-[14px]">
          預計 {md(o.estShipDate)} 出貨
          {o.originalEstShipDate && <span className="ml-2 text-[var(--s-muted)]">（原預計 {md(o.originalEstShipDate)}）</span>}
        </p>
      )}
      {o.shipment && (
        <p className="mt-8 text-[14px]">
          {o.shipment.carrier ?? o.pickup.carrierLabel}
          {o.shipment.trackingNo && (
            <>
              ・物流單號 <span className="num">{o.shipment.trackingNo}</span>
              <CopyBtn text={o.shipment.trackingNo} label="物流單號" />
            </>
          )}
        </p>
      )}

      {/* 明細 */}
      <ul className="mt-10 divide-y divide-[var(--s-line)] border-y border-[var(--s-line)]">
        {o.items.map((it, i) => (
          <li key={i} className="flex gap-4 py-4 text-[14px]">
            <Img src={it.image} alt={it.name} className="aspect-[4/5] w-14 shrink-0" />
            <div className="min-w-0 flex-1">
              <p>{it.name}</p>
              <p className="text-[12px] text-[var(--s-muted)]">
                {it.grind ? `研磨：${it.grind}・` : ""}
                {it.preorder ? "預購・" : ""}× {it.qty}
              </p>
              {it.bundle && <p className="text-[12px] text-[var(--s-muted)]">{it.bundle.map((x) => `${x.name} ×${x.quantity}`).join("、")}</p>}
            </div>
            <span className="num">{nt(it.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-6 space-y-2 text-[14px]">
        <div className="flex justify-between">
          <dt>商品小計</dt>
          <dd className="num">{nt(o.itemsGross)}</dd>
        </div>
        {o.promotions.map((p, i) => (
          <div key={i} className="flex justify-between text-[var(--s-brand)]">
            <dt>{p.name}</dt>
            <dd className="num">−{nt(p.amount)}</dd>
          </div>
        ))}
        <div className="flex justify-between">
          <dt>運費</dt>
          <dd className="num">{o.shippingFee === "0" ? "免運" : nt(o.shippingFee)}</dd>
        </div>
        <div className="flex justify-between border-t border-[var(--s-line)] pt-3 text-base">
          <dt>總計</dt>
          <dd className="num">{nt(o.total)}</dd>
        </div>
        {o.refunded !== "0" && (
          <div className="flex justify-between text-[var(--s-muted)]">
            <dt>已退款</dt>
            <dd className="num">{nt(o.refunded)}</dd>
          </div>
        )}
      </dl>

      <dl className="mt-10 grid grid-cols-[88px_minmax(0,1fr)] gap-y-2 text-[14px]">
        <dt className="text-[var(--s-muted)]">取貨門市</dt>
        <dd>
          {o.pickup.carrierLabel} {o.pickup.storeName}門市（{o.pickup.storeId}）
        </dd>
        <dt className="text-[var(--s-muted)]">收件人</dt>
        <dd>
          {o.contact.name}・{o.contact.phone}
        </dd>
        <dt className="text-[var(--s-muted)]">Email</dt>
        <dd className="break-all">{o.contact.email}</dd>
      </dl>

      <div className="mt-12 flex flex-wrap items-center justify-between gap-4 text-[14px]">
        {o.canCancel ? (
          <button type="button" className="min-h-11 underline underline-offset-4" onClick={() => setAskCancel(true)}>
            取消訂單
          </button>
        ) : !cancelled ? (
          <span className="text-[var(--s-muted)]">已付款或付款確認中的訂單，如需取消請聯絡客服{settings?.service.email ? `（${settings.service.email}）` : ""}</span>
        ) : null}
        <Link href="/shop/products/" className="min-h-11 py-3 underline underline-offset-4">
          繼續購物
        </Link>
      </div>

      {askCancel && (
        <Sheet title="取消訂單" onClose={() => setAskCancel(false)}>
          <p className="text-[14px] text-[var(--s-muted)]">取消後無法復原。確定要取消這筆訂單嗎？</p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button type="button" className="s-btn s-btn-line" onClick={() => setAskCancel(false)}>
              先不要
            </button>
            <button type="button" className="s-btn" onClick={cancel}>
              確定取消
            </button>
          </div>
        </Sheet>
      )}
      </div>
    </div>
  );
}

function Row({ k, v, copy, strong }: { k: string; v: string; copy?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-[var(--s-muted)]">{k}</dt>
      <dd className={`num flex items-center text-right ${strong ? "text-lg" : ""}`}>
        {v}
        {copy && <CopyBtn text={copy} label={k} />}
      </dd>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <OrderPage />
    </Suspense>
  );
}

