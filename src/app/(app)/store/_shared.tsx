"use client";

import { useState } from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { fb } from "@/lib/firebase";
import { toast } from "@/components/toast";
import { Button } from "@/components/ui";
import { toTaipeiLocalInput } from "@/lib/time";

export const STORE_STATUS: Record<string, string> = { DRAFT: "草稿", ACTIVE: "上架", HIDDEN: "下架", COMING_SOON: "即將推出" };
export const PAY_LABEL: Record<string, string> = { UNPAID: "未付款", PENDING_CONFIRMATION: "已回報待對帳", UNDER_REVIEW: "對帳中", PAID: "已付款", REJECTED: "回報有誤", EXPIRED: "已逾期", REFUND_PENDING: "待退款", PARTIALLY_REFUNDED: "部分退款", REFUNDED: "已退款" };
export const PROMO_TYPE: Record<string, string> = { AMOUNT: "固定金額", PERCENT: "百分比", FREE_SHIPPING: "免運", COMBO: "組合優惠" };
export const SECTION_TYPE: Record<string, string> = { HERO: "主視覺", FEATURED: "推薦商品（本期選集）", CATEGORIES: "商品分類", EVENT: "節慶活動", PAGE: "內容頁", FOOTER: "頁尾", SEO: "SEO 與分享圖" };
export const PAGE_KEY: Record<string, string> = { story: "品牌故事", guide: "購物須知", returns: "退換貨", privacy: "隱私權政策", terms: "服務條款", contact: "聯絡我們" };

/** ISO → datetime-local（臺北時間）供表單預設值 */
export const local = (iso: unknown) => (iso ? toTaipeiLocalInput(new Date(String(iso))) : "");

/** 上傳商城圖片（Storage store/，公開讀取），回傳下載網址 */
export async function uploadStoreImage(f: File) {
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  if (!["jpg", "jpeg", "png", "webp"].includes(ext)) throw new Error("請選擇 JPG／PNG／WebP 圖片");
  if (f.size > 5 * 1024 * 1024) throw new Error("檔案過大（上限 5MB）");
  const r = ref(fb().storage, `store/${crypto.randomUUID()}.${ext === "jpeg" ? "jpg" : ext}`);
  await uploadBytes(r, f, { contentType: f.type });
  return getDownloadURL(r);
}

export function UploadButton({ onDone, label = "上傳圖片" }: { onDone: (url: string) => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-border px-3 text-sm hover:bg-surface-2">
      {busy ? "上傳中…" : label}
      <input
        type="file"
        accept=".jpg,.jpeg,.png,.webp"
        className="sr-only"
        disabled={busy}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          try {
            onDone(await uploadStoreImage(f));
          } catch (err) {
            toast((err as Error).message || "上傳失敗", "error");
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

/** 商品圖片清單：上傳、排序、替代文字 */
export function ImageList({ value, onChange }: { value: Array<{ url: string; alt: string }>; onChange: (v: Array<{ url: string; alt: string }>) => void }) {
  const move = (i: number, d: number) => {
    const n = [...value];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    onChange(n);
  };
  return (
    <div className="grid gap-3">
      {value.map((im, i) => (
        <div key={i} className="flex items-center gap-3">
          <img src={im.url} alt="" className="h-16 w-[52px] rounded border border-border object-cover" />
          <input className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 text-sm" placeholder="替代文字（例：耶加雪菲 100g 包裝正面）" value={im.alt} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))} />
          <Button type="button" size="sm" variant="ghost" aria-label="上移" disabled={i === 0} onClick={() => move(i, -1)}>
            <ArrowUp size={14} />
          </Button>
          <Button type="button" size="sm" variant="ghost" aria-label="下移" disabled={i === value.length - 1} onClick={() => move(i, 1)}>
            <ArrowDown size={14} />
          </Button>
          <Button type="button" size="sm" variant="ghost" aria-label="移除" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <UploadButton onDone={(url) => onChange([...value, { url, alt: "" }])} />
        <span className="text-xs text-muted">建議比例 4:5、寬 1200px 以上；第一張為主圖</span>
      </div>
    </div>
  );
}

export const inputCls = "h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm text-fg";
export const labelCls = "grid gap-1 text-xs text-muted";
