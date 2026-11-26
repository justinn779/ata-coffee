"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Check, Copy, Minus, Plus, X } from "lucide-react";
import { basePath } from "@/lib/firebase-lite";
import { md, nt, STATE_LABEL, type PublicProduct, type PublicVariant } from "@/lib/shop";

/**
 * Ati & Ato 吉祥物。專案目前沒有正式角色素材，顯示明確的佔位圖（不冒充正式角色）。
 * 取得正式素材後放到 public/brand/mascot/ati.png、ato.png，並把 OFFICIAL_MASCOT 改為 true。
 */
const OFFICIAL_MASCOT = false;
export function Mascot({ name, label }: { name: "ati" | "ato"; label?: string }) {
  if (OFFICIAL_MASCOT) return <img src={`${basePath}/brand/mascot/${name}.png`} alt={name === "ati" ? "Ati" : "Ato"} width={120} height={120} className="h-28 w-28 object-contain" />;
  return (
    <div role="img" aria-label={`${name === "ati" ? "Ati" : "Ato"} 角色佔位圖${label ? `（${label}）` : ""}`} className="flex h-28 w-28 flex-col items-center justify-center rounded-full border border-dashed border-[var(--s-accent)] text-center">
      <span className="serif text-base text-[var(--s-brand)]">{name === "ati" ? "Ati" : "Ato"}</span>
      <span className="mt-1 text-[10px] leading-tight text-[var(--s-muted)]">
        角色素材
        <br />
        待替換
      </span>
    </div>
  );
}

export function Img({ src, alt, className = "", priority = false }: { src?: string | null; alt: string; className?: string; priority?: boolean }) {
  const [err, setErr] = useState(false);
  return (
    <div className={`s-img ${className}`}>
      {src && !err ? (
        <img src={src} alt={alt} loading={priority ? "eager" : "lazy"} decoding="async" onError={() => setErr(true)} />
      ) : (
        <div className="flex h-full w-full items-center justify-center" aria-label={alt} role="img">
          <img src={`${basePath}/brand/logo.png`} alt="" aria-hidden className="w-1/4 opacity-[0.12]" />
        </div>
      )}
    </div>
  );
}

export function Price({ value, list, className = "" }: { value: string | null; list?: string | null; className?: string }) {
  return (
    <span className={`num ${className}`}>
      {nt(value)}
      {list && <s className="ml-2 text-[0.85em] text-[var(--s-muted)]">{nt(list)}</s>}
    </span>
  );
}

export function Qty({ value, onChange, max = 99, label = "數量" }: { value: number; onChange: (n: number) => void; max?: number; label?: string }) {
  return (
    <div className="inline-flex items-center border border-[var(--s-line)] rounded-[4px]" role="group" aria-label={label}>
      <button type="button" className="s-icon-btn" aria-label="減少" disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))}>
        <Minus size={16} strokeWidth={1.5} />
      </button>
      <span className="num w-8 text-center text-[15px]" aria-live="polite">
        {value}
      </span>
      <button type="button" className="s-icon-btn" aria-label="增加" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}

/** 販售狀態：只在需要時顯示（現貨不另外標） */
export function StateText({ v }: { v: Pick<PublicVariant, "state" | "lowStock" | "preorder"> }) {
  if (v.state === "IN_STOCK") return v.lowStock ? <span className="text-[13px] text-[var(--s-danger)]">剩 {v.lowStock} 件</span> : null;
  if (v.state === "PREORDER") return <span className="text-[13px] text-[var(--s-brand)]">預購・{md(v.preorder?.shipDate)} 出貨</span>;
  return <span className="text-[13px] text-[var(--s-muted)]">{STATE_LABEL[v.state]}</span>;
}

export function ProductCard({ p, onQuick, priority }: { p: PublicProduct; onQuick?: (p: PublicProduct) => void; priority?: boolean }) {
  const v = p.variants[0];
  const buyable = p.variants.some((x) => x.state === "IN_STOCK" || x.state === "PREORDER");
  const listCheapest = p.variants.find((x) => x.price === p.minPrice)?.listPrice ?? null;
  return (
    <div className="group s-fade">
      <Link href={`/shop/p/?s=${encodeURIComponent(p.slug)}`} className="block">
        <Img src={p.images[0]?.url} alt={p.images[0]?.alt ?? p.name} className="aspect-[4/5] w-full" priority={priority} />
      </Link>
      <div className="mt-3 flex items-start justify-between gap-2">
        <Link href={`/shop/p/?s=${encodeURIComponent(p.slug)}`} className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] leading-snug">{p.name}</h3>
          {p.flavor && <p className="mt-0.5 truncate text-[13px] text-[var(--s-muted)]">{p.flavor}</p>}
          <p className="mt-1.5 text-[14px]">
            <Price value={p.variants.length > 1 ? p.minPrice : (v?.price ?? null)} list={p.variants.length > 1 ? null : listCheapest} />
            {p.variants.length > 1 && <span className="ml-1 text-[12px] text-[var(--s-muted)]">起</span>}
          </p>
          <div className="mt-0.5 h-5">{v && (p.state !== "IN_STOCK" ? <StateText v={{ state: p.state, lowStock: null, preorder: p.variants.find((x) => x.preorder)?.preorder ?? null }} /> : null)}</div>
        </Link>
        {onQuick && buyable && !p.variants.some((x) => x.customBundle) && (
          <button type="button" className="s-icon-btn -mr-2 -mt-2 shrink-0" aria-label={`加入購物袋：${p.name}`} onClick={() => onQuick(p)}>
            <Plus size={20} strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
}

/** 底部抽屜（手機）／置中對話框（桌面） */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="關閉" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="s-sheet relative max-h-[85dvh] w-full overflow-y-auto rounded-t-[6px] bg-[var(--s-bg)] p-6 pb-8 md:max-w-md md:rounded-[6px]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base">{title}</h2>
          <button type="button" className="s-icon-btn -mr-3" aria-label="關閉" onClick={onClose}>
            <X size={20} strokeWidth={1.5} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, error, children, hint }: { label: string; error?: string | null; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="s-label">{label}</span>
      {children}
      {hint && !error && <span className="mt-1.5 block text-[12px] text-[var(--s-muted)]">{hint}</span>}
      {error && (
        <span className="mt-1.5 block text-[13px] text-[var(--s-danger)]" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

export function CopyBtn({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="s-icon-btn -my-2"
      aria-label={`複製${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {
          /* 不支援剪貼簿時忽略 */
        }
      }}
    >
      {ok ? <Check size={16} strokeWidth={1.5} /> : <Copy size={16} strokeWidth={1.5} />}
    </button>
  );
}

export function Loading() {
  return (
    <div className="s-wrap py-24 text-center text-sm text-[var(--s-muted)]" role="status">
      載入中…
    </div>
  );
}

export function ErrorBlock({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="s-wrap py-24 text-center">
      <p className="text-sm text-[var(--s-muted)]">{message}</p>
      {retry && (
        <button type="button" className="s-btn s-btn-line mt-6" onClick={retry}>
          重新載入
        </button>
      )}
    </div>
  );
}

export function SkeletonGrid({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4 md:gap-x-6">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} aria-hidden>
          <div className="aspect-[4/5] bg-[var(--s-bg-2)]" />
          <div className="mt-3 h-4 w-2/3 bg-[var(--s-bg-2)]" />
          <div className="mt-2 h-3 w-1/3 bg-[var(--s-bg-2)]" />
        </div>
      ))}
    </div>
  );
}
