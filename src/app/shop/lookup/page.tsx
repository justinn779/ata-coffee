"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { shopCall } from "@/lib/shop";
import { useShop } from "../_shell";
import { Field, Loading } from "../_ui";

/** 訪客查詢訂單：訂單編號＋Email → 寄驗證碼 → 驗證後取得訂單連結（不會只憑訂單編號顯示內容） */
function Lookup() {
  const router = useRouter();
  const sp = useSearchParams();
  const { user } = useShop();
  const [orderNo, setOrderNo] = useState(sp.get("no") ?? "");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"ask" | "code">("ask");
  const [claim, setClaim] = useState(true);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.title = "訂單查詢｜ATA Coffee";
  }, []);

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await shopCall<{ message: string }>("lookup.request", { orderNo: orderNo.trim().toUpperCase(), email: email.trim() });
      setMsg({ text: r.message });
      setStep("code");
    } catch (err) {
      setMsg({ text: (err as Error).message, bad: true });
    } finally {
      setBusy(false);
    }
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await shopCall<{ token: string }>("lookup.verify", { orderNo: orderNo.trim().toUpperCase(), email: email.trim(), code: code.trim(), claim: !!user && claim });
      router.replace(`/shop/order/?t=${encodeURIComponent(r.token)}`);
    } catch (err) {
      setMsg({ text: (err as Error).message, bad: true });
      setBusy(false);
    }
  };

  return (
    <div className="s-wrap pt-10 md:pt-16">
      <div className="mx-auto max-w-sm">
        <h1 className="serif text-2xl">訂單查詢</h1>
        {step === "ask" ? (
          <form onSubmit={request} className="mt-8 space-y-4">
            <Field label="訂單編號">
              <input className="s-input num" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="SO-20261126-001" autoCapitalize="characters" required />
            </Field>
            <Field label="下單時填寫的 Email">
              <input className="s-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <button type="submit" className="s-btn w-full" disabled={busy}>
              寄送驗證碼
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-8 space-y-4">
            <Field label="Email 收到的 6 位數驗證碼（10 分鐘內有效）">
              <input className="s-input num tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required />
            </Field>
            {user && (
              <label className="flex min-h-11 items-center gap-3 text-[14px]">
                <input type="checkbox" className="h-5 w-5 accent-[var(--s-brand)]" checked={claim} onChange={(e) => setClaim(e.target.checked)} />
                把這筆訂單加入我的會員帳號
              </label>
            )}
            <button type="submit" className="s-btn w-full" disabled={busy || code.length !== 6}>
              查看訂單
            </button>
            <button type="button" className="min-h-11 w-full text-[14px] underline underline-offset-4" onClick={() => setStep("ask")}>
              重新寄送
            </button>
          </form>
        )}
        {msg && (
          <p className={`mt-4 text-[14px] ${msg.bad ? "text-[var(--s-danger)]" : "text-[var(--s-muted)]"}`} role={msg.bad ? "alert" : "status"}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Lookup />
    </Suspense>
  );
}
