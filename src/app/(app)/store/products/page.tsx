"use client";

import { Suspense, useEffect, useState } from "react";
import { useCol, useDocument, type Row } from "@/lib/data";
import { callOp } from "@/lib/api";
import { useQS, Loading } from "@/lib/page";
import { toast } from "@/components/toast";
import { Badge, Button, Card, CardBody, CardHeader, LinkButton, Notice, PageHeader, SimpleTable, A } from "@/components/ui";
import { fmtMoney } from "@/lib/decimal";
import { ImageList, STORE_STATUS, inputCls, labelCls } from "../_shared";

/** 商城商品：沿用「商品」與「規格」主檔，只另外設定前台要顯示的內容 */
function List() {
  const products = useCol("products", [], "createdAt");
  const variants = useCol("variants");
  return (
    <>
      <PageHeader title="商城商品" description="商品與規格在「商品」建立；這裡設定前台顯示的圖片、風味、介紹、上下架與自選禮盒" actions={<LinkButton href="/products/new/">＋ 新增商品</LinkButton>} />
      <Card>
        <SimpleTable
          head={["商品", "規格", "商城狀態", "網址代稱", "排序", ""]}
          rows={products.data.map((p) => {
            const vs = variants.data.filter((v) => v.productId === p.id && v.status === "ACTIVE");
            const st = p.store?.status ?? "DRAFT";
            return [
              <span key="n" className="flex items-center gap-3">
                {p.store?.images?.[0]?.url ? <img src={p.store.images[0].url} alt="" className="h-10 w-8 rounded object-cover" /> : <span className="h-10 w-8 rounded bg-surface-2" />}
                {p.name}
              </span>,
              vs.map((v) => `${v.name} ${fmtMoney(v.salePrice)}`).join("、") || "—",
              <Badge key="s" tone={st === "ACTIVE" ? "sage" : st === "COMING_SOON" ? "info" : "neutral"}>
                {STORE_STATUS[st]}
              </Badge>,
              p.store?.slug ?? "—",
              p.store?.sortOrder ?? 0,
              <A key="e" href={`/store/products/?id=${p.id}`}>
                設定
              </A>,
            ];
          })}
          empty="還沒有商品"
        />
      </Card>
    </>
  );
}

function Edit({ id }: { id: string }) {
  const p = useDocument("products", id);
  const variants = useCol("variants", [["productId", id]]);
  const allVariants = useCol("variants", [["status", "ACTIVE"]]);
  const [f, setF] = useState<Record<string, any> | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  useEffect(() => {
    if (!p.data || f) return;
    const s = p.data.store ?? {};
    setF({ status: s.status ?? "DRAFT", slug: s.slug ?? "", flavor: s.flavor ?? "", summary: s.summary ?? "", images: s.images ?? [], details: s.details ?? [], grindable: s.grindable !== false, sortOrder: s.sortOrder ?? 0 });
  }, [p.data, f]);
  if (p.loading || !f) return <Loading />;
  if (!p.data) return <Notice tone="danger">找不到商品</Notice>;
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  const save = async () => {
    const r = await callOp("store.product.save", { productId: id, ...f, sortOrder: Number(f.sortOrder) || 0 });
    toast(r.ok ? (r.message ?? "已儲存") : r.error, r.ok ? "success" : "error");
  };
  return (
    <>
      <PageHeader title={`商城設定：${p.data.name}`} back={{ href: "/store/products/", label: "商城商品" }} actions={f.slug ? <LinkButton variant="outline" target="_blank" href={`/shop/p/?s=${f.slug}`}>前台預覽</LinkButton> : null} />
      <div className="grid gap-4">
        <Card>
          <CardHeader title="前台顯示" description="文字越少越好：名稱、一句風味、必要資訊即可" />
          <CardBody className="grid gap-4 md:grid-cols-2">
            <label className={labelCls}>
              狀態
              <select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value)}>
                {Object.entries(STORE_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              網址代稱（小寫英數字與 -，留空自動產生）
              <input className={inputCls} value={f.slug} onChange={(e) => set("slug", e.target.value)} placeholder="yirgacheffe" />
            </label>
            <label className={labelCls}>
              簡短風味（列表與商品頁顯示）
              <input className={inputCls} value={f.flavor} maxLength={60} onChange={(e) => set("flavor", e.target.value)} placeholder="茉莉花、檸檬、紅茶" />
            </label>
            <label className={labelCls}>
              排序（小的在前）
              <input className={inputCls} type="number" value={f.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} />
            </label>
            <label className={`${labelCls} md:col-span-2`}>
              商品介紹（收合顯示，選填）
              <textarea className={`${inputCls} h-24 py-2`} value={f.summary} maxLength={300} onChange={(e) => set("summary", e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.grindable} onChange={(e) => set("grindable", e.target.checked)} className="accent-[var(--primary)]" />
              提供免費代客研磨（只對咖啡豆有效）
            </label>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="商品圖片" />
          <CardBody>
            <ImageList value={f.images} onChange={(v) => set("images", v)} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="收合資訊" description="產地、處理法、沖煮建議、保存方式、食品標示等（顧客點開才看到）" />
          <CardBody className="grid gap-3">
            {f.details.map((d: { title: string; body: string }, i: number) => (
              <div key={i} className="grid gap-2 md:grid-cols-[200px_1fr_auto]">
                <input className={inputCls} placeholder="標題" value={d.title} onChange={(e) => set("details", f.details.map((x: object, j: number) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <textarea className={`${inputCls} h-20 py-2`} placeholder="內容" value={d.body} onChange={(e) => set("details", f.details.map((x: object, j: number) => (j === i ? { ...x, body: e.target.value } : x)))} />
                <Button type="button" variant="ghost" size="sm" onClick={() => set("details", f.details.filter((_: unknown, j: number) => j !== i))}>
                  移除
                </Button>
              </div>
            ))}
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => set("details", [...f.details, { title: "", body: "" }])}>
                ＋ 新增一段
              </Button>
            </div>
          </CardBody>
        </Card>
        <div>
          <Button onClick={save}>儲存商城設定</Button>
        </div>
        <Card>
          <CardHeader title="規格" description="價格、重量、庫存方式在「商品 → 規格」修改" />
          <CardBody className="grid gap-4">
            {variants.data.map((v) => (
              <VariantStore key={v.id} v={v} all={allVariants.data} />
            ))}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function VariantStore({ v, all }: { v: Row; all: Row[] }) {
  const s = v.store ?? {};
  const [visible, setVisible] = useState(s.visible !== false);
  const [sortOrder, setSort] = useState(String(s.sortOrder ?? 0));
  const [cb, setCb] = useState<{ eligibleVariantIds: string[]; min: string; max: string; allowRepeat: boolean; pricing: string; extra: string } | null>(s.customBundle ? { ...s.customBundle, min: String(s.customBundle.min), max: String(s.customBundle.max), extra: String(s.customBundle.extra ?? "0") } : null);
  const save = async () => {
    const r = await callOp("store.variant.save", { variantId: v.id, visible, sortOrder: Number(sortOrder) || 0, customBundle: cb ? { ...cb, min: Number(cb.min), max: Number(cb.max) } : null });
    toast(r.ok ? "已儲存" : r.error, r.ok ? "success" : "error");
  };
  const options = all.filter((x) => !x.isBundle);
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="font-medium">{v.name}</span>
        <span className="text-sm text-muted">{fmtMoney(v.salePrice)}</span>
        {v.isBundle && <Badge>{cb ? "自選禮盒" : "固定組合"}</Badge>}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="accent-[var(--primary)]" />
          前台顯示
        </label>
        <label className="flex items-center gap-2 text-sm">
          排序 <input className="h-8 w-16 rounded border border-border bg-bg px-2" type="number" value={sortOrder} onChange={(e) => setSort(e.target.value)} />
        </label>
        <Button size="sm" variant="outline" onClick={save}>
          儲存
        </Button>
      </div>
      {v.isBundle && (
        <div className="mt-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!cb} onChange={(e) => setCb(e.target.checked ? { eligibleVariantIds: [], min: "3", max: "3", allowRepeat: true, pricing: "FIXED", extra: "0" } : null)} className="accent-[var(--primary)]" />
            顧客自選內容（自選禮盒）
          </label>
          {cb && (
            <div className="mt-3 grid gap-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <label className={labelCls}>
                  最少件數
                  <input className={inputCls} type="number" value={cb.min} onChange={(e) => setCb({ ...cb, min: e.target.value })} />
                </label>
                <label className={labelCls}>
                  最多件數
                  <input className={inputCls} type="number" value={cb.max} onChange={(e) => setCb({ ...cb, max: e.target.value })} />
                </label>
                <label className={labelCls}>
                  計價
                  <select className={inputCls} value={cb.pricing} onChange={(e) => setCb({ ...cb, pricing: e.target.value })}>
                    <option value="FIXED">固定售價（規格售價）</option>
                    <option value="SUM_PLUS">所選商品加總＋加價</option>
                  </select>
                </label>
                <label className={labelCls}>
                  加價（元）
                  <input className={inputCls} type="number" value={cb.extra} disabled={cb.pricing !== "SUM_PLUS"} onChange={(e) => setCb({ ...cb, extra: e.target.value })} />
                </label>
                <label className="flex items-end gap-2 pb-2 text-sm">
                  <input type="checkbox" checked={cb.allowRepeat} onChange={(e) => setCb({ ...cb, allowRepeat: e.target.checked })} className="accent-[var(--primary)]" />
                  可重複選同一款
                </label>
              </div>
              <fieldset>
                <legend className="mb-2 text-xs text-muted">可選商品</legend>
                <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {options.map((o) => (
                    <label key={o.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="accent-[var(--primary)]" checked={cb.eligibleVariantIds.includes(o.id)} onChange={(e) => setCb({ ...cb, eligibleVariantIds: e.target.checked ? [...cb.eligibleVariantIds, o.id] : cb.eligibleVariantIds.filter((x) => x !== o.id) })} />
                      {o.productName}｜{o.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="text-xs text-muted">禮盒紙盒等包材請在「商品 → 規格」的包材設定；下單時會一起預留、出貨時扣除。</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Page() {
  const id = useQS("id");
  return id ? <Edit id={id} /> : <List />;
}

export default function StoreProducts() {
  return (
    <Suspense fallback={<Loading />}>
      <Page />
    </Suspense>
  );
}
