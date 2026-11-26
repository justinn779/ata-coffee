"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { shopCall, type StorePublicSettings } from "@/lib/shop";
import { Img, Loading } from "../_ui";

const KEYS = { story: "品牌故事", guide: "購物須知", privacy: "隱私權政策", terms: "服務條款", contact: "聯絡我們", returns: "退換貨" } as const;
type Key = keyof typeof KEYS;

/** 靜態內容頁：內容由後台「首頁與內容」管理；沒有內容時顯示待補說明（不自行編造法規文字） */
function ContentPage() {
  const sp = useSearchParams();
  const k = (sp.get("k") ?? "") as Key;
  const preview = sp.get("preview") === "1";
  const [d, setD] = useState<{ page: { title: string; body: string; image: string | null } | null; settings?: StorePublicSettings } | null>(null);
  useEffect(() => {
    if (!(k in KEYS)) return;
    document.title = `${KEYS[k]}｜ATA Coffee`;
    (async () => {
      if (preview) {
        const { callOp } = await import("@/lib/api");
        const r = await callOp<{ page: { title: string; body: string; image: string | null } | null }>("store.content.preview", { page: k });
        if (r.ok) return setD({ page: r.data?.page ?? null });
      }
      setD(await shopCall("page.get", { key: k }));
    })().catch(() => setD({ page: null }));
  }, [k, preview]);

  if (!(k in KEYS))
    return (
      <div className="s-wrap py-24 text-center">
        <p className="text-sm text-[var(--s-muted)]">找不到這個頁面</p>
      </div>
    );
  if (!d) return <Loading />;
  const s = d.settings;
  return (
    <article className="s-wrap pt-10 md:pt-16">
      <div className="mx-auto max-w-2xl">
        <h1 className="serif text-2xl">{d.page?.title || KEYS[k]}</h1>
        {d.page?.image && <Img src={d.page.image} alt={d.page.title} className="mt-8 aspect-[3/2] w-full" />}
        {d.page?.body ? (
          <div className="mt-8 whitespace-pre-line text-[15px] leading-[1.9]">{d.page.body}</div>
        ) : (
          <p className="mt-8 text-[14px] text-[var(--s-muted)]">內容準備中。</p>
        )}
        {k === "contact" && s && (
          <dl className="mt-10 grid grid-cols-[88px_minmax(0,1fr)] gap-y-3 text-[15px]">
            {s.service.email && (
              <>
                <dt className="text-[var(--s-muted)]">Email</dt>
                <dd>
                  <a href={`mailto:${s.service.email}`} className="underline underline-offset-4">
                    {s.service.email}
                  </a>
                </dd>
              </>
            )}
            {s.service.phone && (
              <>
                <dt className="text-[var(--s-muted)]">電話</dt>
                <dd>{s.service.phone}</dd>
              </>
            )}
            {s.service.lineUrl && (
              <>
                <dt className="text-[var(--s-muted)]">LINE</dt>
                <dd>
                  <a href={s.service.lineUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                    加入好友
                  </a>
                </dd>
              </>
            )}
            {s.service.hours && (
              <>
                <dt className="text-[var(--s-muted)]">服務時間</dt>
                <dd>{s.service.hours}</dd>
              </>
            )}
          </dl>
        )}
        <Link href="/shop/" className="mt-12 inline-flex min-h-11 items-center text-[14px] underline underline-offset-4">
          回到首頁
        </Link>
      </div>
    </article>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <ContentPage />
    </Suspense>
  );
}
