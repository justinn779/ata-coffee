"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithCustomToken, signInWithPopup } from "firebase/auth";
import { shopFb } from "@/lib/firebase-lite";
import { googleErrorMessage, googleProvider } from "@/lib/google-auth";
import { isEmulator, lineStartUrl, shopCall } from "@/lib/shop";
import { useShop } from "../_shell";
import { Loading } from "../_ui";

const safeReturn = (v: string | null) => (v && v.startsWith("/shop/") && !v.startsWith("//") ? v : "/shop/account/");

function Login() {
  const sp = useSearchParams();
  const router = useRouter();
  const { user, authReady } = useShop();
  const back = safeReturn(sp.get("return"));
  const [error, setError] = useState<string | null>(sp.get("error"));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.title = "登入｜ATA Coffee";
  }, []);
  useEffect(() => {
    if (authReady && user) router.replace(back);
  }, [authReady, user, back, router]);

  const google = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithPopup(shopFb().auth, googleProvider());
    } catch (e) {
      setError(googleErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const mock = async (provider: "google" | "line") => {
    setBusy(true);
    try {
      const r = await shopCall<{ customToken: string }>("dev.mockLogin", { provider, name: "測試會員", email: `${provider}-member@example.test` });
      await signInWithCustomToken(shopFb().auth, r.customToken);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="s-wrap pt-10 md:pt-16">
      <div className="mx-auto max-w-sm">
        <h1 className="serif text-2xl">登入</h1>
        <p className="mt-2 text-[14px] text-[var(--s-muted)]">登入後可查看歷史訂單、記住收件資料。不登入也能購買。</p>
        <div className="mt-8 space-y-3">
          <button type="button" className="s-btn s-btn-line w-full" onClick={google} disabled={busy}>
            <GoogleIcon />
            使用 Google 登入
          </button>
          <a href={lineStartUrl(back)} className="s-btn s-btn-line w-full" aria-disabled={busy}>
            <span aria-hidden className="flex h-[18px] w-[18px] items-center justify-center rounded-[4px] bg-[#06C755] text-[9px] font-bold text-white">L</span>
            使用 LINE 登入
          </a>
        </div>
        {error && (
          <p className="mt-4 text-[14px] text-[var(--s-danger)]" role="alert">
            {error}
          </p>
        )}
        {isEmulator && (
          <div className="mt-10 border-t border-dashed border-[var(--s-line)] pt-6">
            <p className="text-[12px] text-[var(--s-danger)]">測試環境專用（正式環境不會出現）</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="s-chip" onClick={() => mock("google")} disabled={busy}>
                測試會員 A
              </button>
              <button type="button" className="s-chip" onClick={() => mock("line")} disabled={busy}>
                測試會員 B
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Login />
    </Suspense>
  );
}
