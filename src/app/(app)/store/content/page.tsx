"use client";

import { Suspense, useEffect, useState } from "react";
import { useCol, useDocument } from "@/lib/data";
import { callOp } from "@/lib/api";
import { useQS, Loading } from "@/lib/page";
import { toast } from "@/components/toast";
import { ActionDialog } from "@/components/action-dialog";
import { Badge, Button, Card, CardBody, LinkButton, Notice, PageHeader, SimpleTable, A } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";
import { inputCls, labelCls, local, PAGE_KEY, SECTION_TYPE, UploadButton } from "../_shared";

/** 首頁與內容：固定版型；每個區塊編輯草稿 → 預覽 → 發布。沒有內容或不在活動期間的區塊前台自動隱藏 */
function List() {
  const cs = useCol("storeContent");
  const rows = [...cs.data].sort((a, b) => (a.type === "PAGE" ? 1 : 0) - (b.type === "PAGE" ? 1 : 0) || Number(a.order ?? 0) - Number(b.order ?? 0));
  return (
    <>
      <PageHeader
        title="首頁與內容"
        description="首頁區塊依排序由上到下顯示；內容頁（品牌故事、購物須知、隱私權…）也在這裡編輯"
        actions={
          <>
            <LinkButton variant="outline" target="_blank" href="/shop/?preview=1">
              預覽草稿首頁
            </LinkButton>
            <LinkButton href="/store/content/?id=new">＋ 新增區塊</LinkButton>
          </>
        }
      />
      <Card>
        <SimpleTable
          head={["區塊", "標題", "排序", "狀態", "發布時間", ""]}
          rows={rows.map((c) => {
            const changed = JSON.stringify(c.draft) !== JSON.stringify(c.published);
            return [
              <A key="n" href={`/store/content/?id=${c.id}`}>
                {c.type === "PAGE" ? `內容頁：${PAGE_KEY[c.key] ?? c.key}` : SECTION_TYPE[c.type]}
              </A>,
              c.draft?.title ?? "—",
              c.type === "PAGE" ? "—" : c.order,
              <span key="s" className="flex gap-1">
                {!c.enabled ? <Badge>停用</Badge> : c.published ? <Badge tone="sage">已發布</Badge> : <Badge tone="warning">未發布</Badge>}
                {c.published && changed && <Badge tone="info">草稿有修改</Badge>}
              </span>,
              c.publishedAt ? fmtDateTime(c.publishedAt) : "—",
              <span key="a" className="flex gap-1">
                <ActionDialog label="發布" size="sm" title="發布這個區塊" description="前台會立即顯示草稿內容。" payload={{ id: c.id }} action={(i) => callOp("store.content.publish", i)} successMessage="已發布" />
                {c.published && <ActionDialog label="取消發布" size="sm" variant="ghost" title="取消發布" payload={{ id: c.id, unpublish: true }} action={(i) => callOp("store.content.publish", i)} successMessage="已取消發布" />}
              </span>,
            ];
          })}
          empty="還沒有內容區塊"
        />
      </Card>
    </>
  );
}

const BLANK = { title: "", text: "", body: "", imageDesktop: "", imageMobile: "", imageAlt: "", link: "", linkLabel: "", productIds: [] as string[], startAt: "", endAt: "" };

function Edit({ id }: { id: string }) {
  const isNew = id === "new";
  const doc = useDocument("storeContent", isNew ? null : id);
  const products = useCol("products", [], "createdAt");
  const [f, setF] = useState<{ type: string; key: string; order: string; enabled: boolean; draft: typeof BLANK } | null>(null);
  useEffect(() => {
    if (f || (!isNew && doc.loading)) return;
    const d = doc.data;
    setF({ type: d?.type ?? "HERO", key: d?.key ?? "story", order: String(d?.order ?? 0), enabled: d?.enabled ?? true, draft: { ...BLANK, ...(d?.draft ?? {}), startAt: local(d?.draft?.startAt), endAt: local(d?.draft?.endAt) } });
  }, [doc.loading, doc.data, f, isNew]);
  if (!f) return <Loading />;
  const d = f.draft;
  const setD = (k: keyof typeof BLANK, v: unknown) => setF({ ...f, draft: { ...d, [k]: v } });
  const t = f.type;
  const save = async (publish: boolean) => {
    const r = await callOp<{ message: string }>("store.content.save", { id: isNew ? null : id, type: t, key: t === "PAGE" ? f.key : null, order: Number(f.order) || 0, enabled: f.enabled, draft: d });
    if (!r.ok) return toast(r.error, "error");
    if (publish && !isNew) {
      const p = await callOp("store.content.publish", { id });
      return toast(p.ok ? "已發布" : p.error, p.ok ? "success" : "error");
    }
    toast(isNew ? "已建立草稿，請回列表發布" : "已儲存草稿");
    if (isNew) window.history.replaceState(null, "", window.location.pathname);
  };
  const preview = t === "PAGE" ? `/shop/page/?k=${f.key}&preview=1` : "/shop/?preview=1";
  return (
    <>
      <PageHeader title={isNew ? "新增區塊" : `編輯：${t === "PAGE" ? PAGE_KEY[f.key] : SECTION_TYPE[t]}`} back={{ href: "/store/content/", label: "首頁與內容" }} actions={!isNew && <LinkButton variant="outline" target="_blank" href={preview}>預覽草稿</LinkButton>} />
      {t === "PAGE" && ["privacy", "terms", "returns", "guide"].includes(f.key) && <Notice tone="warning">法規相關頁面（隱私權、退換貨、購物須知）請由商家確認內容是否符合消費者保護法、個人資料保護法與食品相關規範後再發布。</Notice>}
      <Card className="mt-4">
        <CardBody className="grid gap-4 md:grid-cols-2">
          <label className={labelCls}>
            區塊類型
            <select className={inputCls} value={t} disabled={!isNew} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {Object.entries(SECTION_TYPE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {t === "PAGE" ? (
            <label className={labelCls}>
              內容頁
              <select className={inputCls} value={f.key} disabled={!isNew} onChange={(e) => setF({ ...f, key: e.target.value })}>
                {Object.entries(PAGE_KEY).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className={labelCls}>
              排序（小的在上）
              <input className={inputCls} type="number" value={f.order} onChange={(e) => setF({ ...f, order: e.target.value })} />
            </label>
          )}
          <label className={labelCls}>
            標題
            <input className={inputCls} value={d.title} maxLength={80} onChange={(e) => setD("title", e.target.value)} />
          </label>
          {["HERO", "EVENT", "SEO"].includes(t) && (
            <label className={labelCls}>
              簡短文案（一句話）
              <input className={inputCls} value={d.text} maxLength={300} onChange={(e) => setD("text", e.target.value)} />
            </label>
          )}
          {["PAGE", "FOOTER"].includes(t) && (
            <label className={`${labelCls} md:col-span-2`}>
              內文
              <textarea className={`${inputCls} h-64 py-2`} value={d.body} onChange={(e) => setD("body", e.target.value)} />
            </label>
          )}
          {["HERO", "EVENT", "PAGE", "SEO"].includes(t) && (
            <>
              <div className={labelCls}>
                {t === "SEO" ? "分享圖片（1200×630）" : "桌面圖片"}
                <div className="flex items-center gap-2">
                  {d.imageDesktop && <img src={d.imageDesktop} alt="" className="h-10 w-16 rounded object-cover" />}
                  <UploadButton onDone={(u) => setD("imageDesktop", u)} />
                  {d.imageDesktop && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setD("imageDesktop", "")}>
                      移除
                    </Button>
                  )}
                </div>
              </div>
              {t !== "SEO" && t !== "PAGE" && (
                <div className={labelCls}>
                  手機圖片（4:5，留空用桌面圖）
                  <div className="flex items-center gap-2">
                    {d.imageMobile && <img src={d.imageMobile} alt="" className="h-12 w-10 rounded object-cover" />}
                    <UploadButton onDone={(u) => setD("imageMobile", u)} />
                    {d.imageMobile && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setD("imageMobile", "")}>
                        移除
                      </Button>
                    )}
                  </div>
                </div>
              )}
              <label className={labelCls}>
                圖片替代文字
                <input className={inputCls} value={d.imageAlt} maxLength={100} onChange={(e) => setD("imageAlt", e.target.value)} />
              </label>
            </>
          )}
          {["HERO", "EVENT"].includes(t) && (
            <>
              <label className={labelCls}>
                連結（/shop/ 開頭或 https 網址）
                <input className={inputCls} value={d.link} onChange={(e) => setD("link", e.target.value)} placeholder="/shop/products/?c=beans" />
              </label>
              <label className={labelCls}>
                按鈕文字
                <input className={inputCls} value={d.linkLabel} maxLength={20} onChange={(e) => setD("linkLabel", e.target.value)} placeholder="選購" />
              </label>
              <label className={labelCls}>
                開始時間（選填）
                <input className={inputCls} type="datetime-local" value={d.startAt} onChange={(e) => setD("startAt", e.target.value)} />
              </label>
              <label className={labelCls}>
                結束時間（選填）
                <input className={inputCls} type="datetime-local" value={d.endAt} onChange={(e) => setD("endAt", e.target.value)} />
              </label>
            </>
          )}
          {t === "FEATURED" && (
            <fieldset className="md:col-span-2">
              <legend className="mb-2 text-xs text-muted">推薦商品（依勾選順序；售完的商品自動隱藏）</legend>
              <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {products.data.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="accent-[var(--primary)]" checked={d.productIds.includes(p.id)} onChange={(e) => setD("productIds", e.target.checked ? [...d.productIds, p.id] : d.productIds.filter((x) => x !== p.id))} />
                    {p.name}
                    {p.store?.status !== "ACTIVE" && <span className="text-xs text-muted">（未上架）</span>}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} className="accent-[var(--primary)]" />
            啟用這個區塊
          </label>
        </CardBody>
      </Card>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => save(false)}>儲存草稿</Button>
        {!isNew && (
          <Button variant="outline" onClick={() => save(true)}>
            儲存並發布
          </Button>
        )}
        {!isNew && <ActionDialog label="刪除區塊" variant="danger" title="刪除這個區塊" description="刪除後無法復原。" payload={{ id }} action={(i) => callOp("store.content.delete", i)} successMessage="已刪除" redirectTo="/store/content/" />}
      </div>
    </>
  );
}

function Page() {
  const id = useQS("id");
  return id ? <Edit id={id} /> : <List />;
}
export default function Content() {
  return (
    <Suspense fallback={<Loading />}>
      <Page />
    </Suspense>
  );
}

