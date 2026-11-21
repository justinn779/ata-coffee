"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { fb } from "@/lib/firebase";
import { fmtDate, fmtDbDate } from "@/lib/time";
import { BrandMark } from "@/components/brand";

type Trace = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** 公開 QR Code 商品履歷（不需登入；只讀取已發布的 publicTraces 文件） */
function TraceView() {
  const code = useSearchParams().get("c") ?? "";
  const [t, setT] = useState<Trace | null | undefined>(undefined);
  useEffect(() => {
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(code)) return setT(null);
    getDoc(doc(fb().db, "publicTraces", code))
      .then((s) => setT(s.exists() && s.data().published ? s.data() : null))
      .catch(() => setT(null));
  }, [code]);
  if (t === undefined) return <p className="py-20 text-center text-sm text-muted">載入中…</p>;
  if (t === null) return <p className="py-20 text-center text-sm text-muted">找不到此商品履歷</p>;
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) =>
    v ? (
      <div className="flex justify-between gap-4 border-b border-border py-2.5 text-sm last:border-0">
        <dt className="text-muted">{k}</dt>
        <dd className="text-right">{v}</dd>
      </div>
    ) : null;
  return (
    <>
      {t.series && <p className="text-center text-xs tracking-[0.2em] text-muted">{t.series.code}</p>}
      <h1 className="mt-1 text-center font-serif text-2xl font-semibold">{t.productName}</h1>
      <p className="mt-1 text-center text-sm text-muted">{t.variantName}</p>
      {t.flavorNotes && <p className="mt-5 text-center font-serif text-lg text-primary">{t.flavorNotes}</p>}
      <section className="mt-8 rounded-[var(--radius-card)] border border-border bg-surface p-5">
        <h2 className="mb-2 text-sm font-semibold">咖啡豆</h2>
        <dl>
          <Row k="名稱" v={t.coffee?.name} />
          <Row k="英文名稱" v={t.coffee?.nameEn} />
          <Row k="產國／產區" v={[t.coffee?.country, t.coffee?.region].filter(Boolean).join("・")} />
          <Row k="莊園" v={t.coffee?.farm} />
          <Row k="品種" v={t.coffee?.variety} />
          <Row k="處理法" v={t.coffee?.process} />
          <Row k="海拔" v={t.coffee?.altitude} />
        </dl>
      </section>
      <section className="mt-4 rounded-[var(--radius-card)] border border-border bg-surface p-5">
        <h2 className="mb-2 text-sm font-semibold">批次</h2>
        <dl>
          <Row k="包裝批次" v={t.batchNo} />
          <Row k="烘焙批次" v={t.roastBatchNo} />
          <Row k="烘焙日期" v={t.roastedAt ? fmtDate(t.roastedAt) : null} />
          <Row k="烘焙程度" v={t.roastLevel} />
          <Row k="建議賞味" v={t.peakFrom != null ? `烘焙後第 ${t.peakFrom}–${t.peakTo ?? "?"} 天` : null} />
          <Row k="有效日期" v={t.expiryDate ? fmtDbDate(t.expiryDate) : null} />
        </dl>
      </section>
      {t.recommendedBrew && (
        <section className="mt-4 rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <h2 className="mb-2 text-sm font-semibold">推薦沖煮</h2>
          <p className="text-sm">{t.recommendedBrew}</p>
        </section>
      )}
      {t.series?.story && <p className="mt-6 text-center text-sm leading-relaxed text-muted">{t.series.story}</p>}
    </>
  );
}

export default function PublicTracePage() {
  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 py-8">
      <div className="mb-8 flex justify-center">
        <BrandMark />
      </div>
      <Suspense fallback={<p className="py-20 text-center text-sm text-muted">載入中…</p>}>
        <TraceView />
      </Suspense>
      <p className="mt-10 text-center text-xs text-muted">ATA Coffee · 建議賞味期為風味建議，非食品有效日期</p>
    </main>
  );
}
