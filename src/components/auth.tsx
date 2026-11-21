"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { fb } from "@/lib/firebase";
import { callOp } from "@/lib/api";
import { googleErrorMessage, googleProvider } from "@/lib/google-auth";
import { BrandMark } from "./brand";
import { Button } from "./ui";

interface AuthState {
  user: User | null;
  admin: { name: string; email: string; role: string } | null;
  loading: boolean;
}
const Ctx = createContext<AuthState>({ user: null, admin: null, loading: true });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, admin: null, loading: true });
  useEffect(() => {
    let unsubAdmin: (() => void) | null = null;
    const unsub = onAuthStateChanged(fb().auth, (user) => {
      unsubAdmin?.();
      if (!user) return setState({ user: null, admin: null, loading: false });
      unsubAdmin = onSnapshot(
        doc(fb().db, "admins", user.uid),
        (s) => setState({ user, admin: s.exists() ? (s.data() as AuthState["admin"]) : null, loading: false }),
        () => setState({ user, admin: null, loading: false }),
      );
    });
    return () => {
      unsub();
      unsubAdmin?.();
    };
  }, []);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export const logout = () => signOut(fb().auth);

/** 管理頁面守門：未登入顯示登入表單；登入但非管理員顯示說明（可申請成為初始管理員） */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, admin, loading } = useAuth();
  if (loading) return <FullScreen><p className="text-sm text-muted">載入中…</p></FullScreen>;
  if (!user) return <LoginScreen />;
  if (!admin) return <NotAdmin email={user.email ?? ""} />;
  return <>{children}</>;
}

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>
        {children}
      </div>
    </main>
  );
}

function LoginScreen() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const resetPassword = async () => {
    setError(null);
    setInfo(null);
    const email = emailRef.current?.value.trim() ?? "";
    if (!email || !emailRef.current?.checkValidity()) {
      setError("請先在上方輸入電子郵件，再按「忘記密碼」");
      emailRef.current?.focus();
      return;
    }
    setPending(true);
    try {
      fb().auth.languageCode = "zh-TW";
      await sendPasswordResetEmail(fb().auth, email);
      setInfo("若此電子郵件已註冊，重設密碼信已寄出，請到信箱（含垃圾郵件匣）點選連結設定新密碼。");
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "auth/too-many-requests") setError("嘗試次數過多，請稍後再試");
      else if (code === "auth/invalid-email") setError("電子郵件格式不正確");
      else if (code === "auth/network-request-failed") setError("網路連線失敗，請稍後再試");
      // 不透露帳號是否存在
      else setInfo("若此電子郵件已註冊，重設密碼信已寄出，請到信箱（含垃圾郵件匣）點選連結設定新密碼。");
    } finally {
      setPending(false);
    }
  };
  const google = async () => {
    setError(null);
    setInfo(null);
    setPending(true);
    try {
      fb().auth.languageCode = "zh-TW";
      await signInWithPopup(fb().auth, googleProvider());
    } catch (e) {
      setError(googleErrorMessage(e));
    } finally {
      setPending(false);
    }
  };
  const submit = async (fd: FormData) => {
    setPending(true);
    setError(null);
    setInfo(null);
    try {
      await signInWithEmailAndPassword(fb().auth, String(fd.get("email")).trim(), String(fd.get("password")));
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(code === "auth/too-many-requests" ? "嘗試次數過多，請稍後再試" : "電子郵件或密碼錯誤");
    } finally {
      setPending(false);
    }
  };
  return (
    <FullScreen>
      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6">
        <h1 className="font-serif text-xl font-semibold">管理員登入</h1>
        <p className="mt-1 text-sm text-muted">請使用管理員帳號登入後台</p>
        <form action={submit} className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">電子郵件</span>
            <input ref={emailRef} name="email" type="email" autoComplete="username" required className="h-11 w-full rounded-lg border border-border bg-bg px-3 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">密碼</span>
            <input name="password" type="password" autoComplete="current-password" required className="h-11 w-full rounded-lg border border-border bg-bg px-3 text-sm" />
          </label>
          {error && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {info && (
            <p role="status" className="rounded-lg bg-info-soft px-3 py-2 text-sm">
              {info}
            </p>
          )}
          <Button type="submit" disabled={pending} className="h-11 w-full">
            {pending ? "處理中…" : "登入"}
          </Button>
          <div className="flex items-center gap-3 text-xs text-muted" aria-hidden>
            <span className="h-px flex-1 bg-border" />或<span className="h-px flex-1 bg-border" />
          </div>
          <Button type="button" variant="outline" disabled={pending} onClick={google} className="h-11 w-full">
            使用 Google 登入
          </Button>
          <p className="text-center text-xs text-muted">Google 帳號需先由管理員在「系統設定 → 個人帳號」綁定</p>
          <button type="button" onClick={resetPassword} disabled={pending} className="block w-full text-center text-xs text-muted underline">
            忘記密碼？
          </button>
        </form>
      </div>
      <p className="mt-6 text-center text-xs text-muted">ATA Coffee Management System</p>
    </FullScreen>
  );
}

function NotAdmin({ email }: { email: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const claim = async () => {
    const r = await callOp("admin.claimFirst");
    setMsg(r.ok ? "已成為管理員，載入中…" : r.error);
  };
  return (
    <FullScreen>
      <div className="space-y-4 rounded-[var(--radius-card)] border border-border bg-surface p-6 text-sm">
        <h1 className="font-serif text-xl font-semibold">尚未授權</h1>
        <p className="text-muted">帳號 {email} 不在管理員名單中。</p>
        <p className="text-muted">若這是系統第一次啟用，且此 Email 為部署時指定的初始管理員，可按下方按鈕完成設定。</p>
        <Button onClick={claim}>設定為初始管理員</Button>
        {msg && <p role="alert" className="rounded-lg bg-info-soft px-3 py-2">{msg}</p>}
        <button onClick={logout} className="block text-xs text-muted underline">
          登出
        </button>
      </div>
    </FullScreen>
  );
}
