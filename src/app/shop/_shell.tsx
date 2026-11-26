"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithCustomToken, type User } from "firebase/auth";
import { Menu, ShoppingBag, User as UserIcon, X, MessageCircle } from "lucide-react";
import { shopFb, basePath } from "@/lib/firebase-lite";
import { lineKey, readCart, shopCall, writeCart, type CartLine, type StorePublicSettings } from "@/lib/shop";
import { Mascot } from "./_ui";

interface ShopState {
  settings: StorePublicSettings | null;
  user: User | null;
  authReady: boolean;
  lines: CartLine[];
  count: number;
  add: (l: CartLine) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  toast: (msg: string) => void;
}
const Ctx = createContext<ShopState | null>(null);
export const useShop = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useShop 需在 ShopShell 內使用");
  return c;
};

export function ShopShell({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<StorePublicSettings | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const synced = useRef<string | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    setLines(readCart());
    shopCall<{ settings: StorePublicSettings }>("store.boot")
      .then((r) => setSettings(r.settings))
      .catch(() => setSettings(null));
    // LINE 登入回來：用一次性登入票換登入憑證
    const url = new URL(window.location.href);
    const ticket = url.searchParams.get("ticket");
    if (ticket) {
      url.searchParams.delete("ticket");
      window.history.replaceState(null, "", url.toString());
      shopCall<{ customToken: string }>("auth.redeemTicket", { ticket })
        .then((r) => signInWithCustomToken(shopFb().auth, r.customToken))
        .catch((e) => setMsg(e.message));
    }
    return onAuthStateChanged(shopFb().auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
  }, []);

  // 登入後合併購物車（不同規格、研磨、禮盒內容分開；同一行取較大數量）
  useEffect(() => {
    if (!user || synced.current === user.uid) return;
    synced.current = user.uid;
    shopCall<{ lines: CartLine[] }>("cart.save", { lines: readCart(), merge: true })
      .then((r) => {
        setLines(r.lines);
        writeCart(r.lines);
      })
      .catch(() => undefined);
  }, [user]);

  const persist = useCallback(
    (next: CartLine[]) => {
      setLines(next);
      writeCart(next);
      if (user) shopCall("cart.save", { lines: next }).catch(() => undefined);
    },
    [user],
  );

  const value = useMemo<ShopState>(
    () => ({
      settings,
      user,
      authReady,
      lines,
      count: lines.reduce((n, l) => n + l.qty, 0),
      add: (l) => {
        const k = lineKey(l);
        const cur = readCart();
        const i = cur.findIndex((x) => lineKey(x) === k);
        if (i >= 0) cur[i] = { ...cur[i], qty: Math.min(99, cur[i].qty + l.qty) };
        else cur.push(l);
        persist(cur);
      },
      setQty: (key, qty) => persist(readCart().map((x) => (lineKey(x) === key ? { ...x, qty } : x)).filter((x) => x.qty > 0)),
      remove: (key) => persist(readCart().filter((x) => lineKey(x) !== key)),
      clear: () => persist([]),
      toast: (m) => setMsg(m),
    }),
    [settings, user, authReady, lines, persist],
  );

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3200);
    return () => clearTimeout(t);
  }, [msg]);

  const maintenance = settings?.maintenance && !pathname?.includes("/shop/order") && !pathname?.includes("/shop/lookup");
  return (
    <Ctx.Provider value={value}>
      <div className="shop">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:p-2">
          跳到主要內容
        </a>
        <Header />
        <main id="main" className="flex-1">
          {maintenance ? <Maintenance message={settings?.maintenanceMessage} /> : children}
        </main>
        <Footer />
        {msg && (
          <div role="status" className="s-sheet fixed inset-x-4 top-20 z-50 md:top-24 mx-auto max-w-sm rounded-[4px] bg-[var(--s-fg)] px-4 py-3 text-center text-sm text-[var(--s-bg)]">
            {msg}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

const NAV = [
  { href: "/shop/products/?c=beans", label: "咖啡豆" },
  { href: "/shop/products/?c=drip", label: "濾掛" },
  { href: "/shop/products/?c=gift", label: "禮盒" },
  { href: "/shop/page/?k=story", label: "品牌故事" },
];

function Header() {
  const { count } = useShop();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--s-line)] bg-[var(--s-bg)]/95 backdrop-blur">
      <div className="s-wrap flex h-16 items-center justify-between md:h-20">
        <div className="flex items-center gap-1 md:hidden">
          <button type="button" className="s-icon-btn -ml-2" aria-label="開啟選單" aria-expanded={open} onClick={() => setOpen(true)}>
            <Menu size={22} strokeWidth={1.5} />
          </button>
        </div>
        <Link href="/shop/" aria-label="ATA Coffee 首頁" className="absolute left-1/2 -translate-x-1/2 md:static md:translate-x-0">
          <img src={`${basePath}/brand/logo.png`} alt="ATA Coffee" width={72} height={44} className="h-9 w-auto md:h-11" />
        </Link>
        <nav aria-label="主要選單" className="hidden items-center gap-10 text-[15px] tracking-wider md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="py-2 hover:text-[var(--s-brand)]">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="-mr-2 flex items-center">
          <Link href="/shop/account/" className="s-icon-btn" aria-label="會員">
            <UserIcon size={22} strokeWidth={1.5} />
          </Link>
          <Link href="/shop/cart/" className="s-icon-btn" aria-label={`購物袋，${count} 件商品`}>
            <ShoppingBag size={22} strokeWidth={1.5} />
            {count > 0 && <span className="num absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--s-brand)] px-1 text-[11px] text-[var(--s-bg)]">{count > 99 ? "99+" : count}</span>}
          </Link>
        </div>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="選單">
          <button type="button" aria-label="關閉選單" className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="s-sheet absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col bg-[var(--s-bg)] px-6 pb-8 pt-4">
            <button type="button" className="s-icon-btn -ml-3 mb-6" aria-label="關閉選單" onClick={() => setOpen(false)}>
              <X size={22} strokeWidth={1.5} />
            </button>
            <nav className="flex flex-col text-lg tracking-wider">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="border-b border-[var(--s-line)] py-4">
                  {n.label}
                </Link>
              ))}
              <Link href="/shop/lookup/" className="py-4 text-base text-[var(--s-muted)]">
                訂單查詢
              </Link>
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}

function Footer() {
  const { settings } = useShop();
  const s = settings;
  const b = s?.business;
  return (
    <footer className="mt-24 border-t border-[var(--s-line)] text-[13px] text-[var(--s-muted)]">
      <div className="s-wrap grid gap-8 py-12 md:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <nav aria-label="頁尾" className="flex flex-wrap gap-x-6 gap-y-2 text-[var(--s-fg)]">
            <Link href="/shop/page/?k=guide">購物須知</Link>
            <Link href="/shop/page/?k=returns">退換貨</Link>
            <Link href="/shop/page/?k=privacy">隱私權政策</Link>
            <Link href="/shop/page/?k=terms">服務條款</Link>
            <Link href="/shop/page/?k=contact">聯絡我們</Link>
            <Link href="/shop/lookup/">訂單查詢</Link>
          </nav>
          {/* 業者資訊（法規揭露）：未設定時標示待補 */}
          <p className="leading-relaxed">
            {b?.name || "業者名稱（待補）"}
            {b?.taxId ? `｜統一編號 ${b.taxId}` : ""}
            {b?.foodRegNo ? `｜食品業者登錄字號 ${b.foodRegNo}` : ""}
            <br />
            {b?.address || "營業地址（待補）"}
            {s?.service.phone ? `｜${s.service.phone}` : ""}
            {s?.service.email ? `｜${s.service.email}` : ""}
          </p>
        </div>
        <div className="flex items-start gap-1 md:justify-end">
          {s?.social.instagram && (
            <a className="s-icon-btn" href={s.social.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram">
              <IgIcon />
            </a>
          )}
          {s?.social.facebook && (
            <a className="s-icon-btn" href={s.social.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook">
              <FbIcon />
            </a>
          )}
          {s?.social.line && (
            <a className="s-icon-btn" href={s.social.line} target="_blank" rel="noopener noreferrer" aria-label="LINE">
              <MessageCircle size={20} strokeWidth={1.5} />
            </a>
          )}
        </div>
      </div>
      <p className="s-wrap pb-10 text-[12px]">© ATA Coffee</p>
    </footer>
  );
}

function Maintenance({ message }: { message?: string }) {
  return (
    <div className="s-wrap flex flex-col items-center py-24 text-center">
      <Mascot name="ato" label="維護中" />
      <h1 className="serif mt-8 text-2xl">商城維護中</h1>
      <p className="s-muted mt-3 max-w-sm text-sm leading-relaxed">{message || "我們正在整理店舖，請稍後再來。"}</p>
    </div>
  );
}

/** 線條社群圖示（lucide 已移除品牌圖示） */
function IgIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}
function FbIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z" />
    </svg>
  );
}
