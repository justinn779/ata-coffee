"use client";

import { useEffect, useState } from "react";
import { useDocument } from "@/lib/data";
import { callOp } from "@/lib/api";
import { Loading } from "@/lib/page";
import { toast } from "@/components/toast";
import { Button, Card, CardBody, CardHeader, Notice, PageHeader } from "@/components/ui";
import { inputCls, labelCls } from "../_shared";

/** 與 functions/src/shop/settings.ts 的 DEFAULT_STORE 相同（未設定時的示範值） */
const DEFAULT = {
  open: true,
  maintenance: false,
  maintenanceMessage: "",
  bank: { bankName: "示範銀行（請於後台設定）", bankCode: "000", branch: "", accountNo: "0000000000000", accountName: "ATA Coffee（示範）", isDemo: true },
  paymentDeadlineHours: 72,
  paymentReminderHours: 24,
  shipping: { fee: "60", freeThreshold: "1500", freeBasis: "AFTER_ITEM_DISCOUNT", isDemo: true },
  pickupChannels: [
    { key: "SEVEN", label: "7-ELEVEN", enabled: true },
    { key: "FAMILY", label: "全家", enabled: true },
  ],
  prepDays: 2,
  nonShipWeekdays: [0],
  nonShipDates: [] as string[],
  grindOptions: [
    { key: "POUR_OVER", label: "手沖", enabled: true },
    { key: "ESPRESSO", label: "義式", enabled: true },
    { key: "FRENCH_PRESS", label: "法壓", enabled: true },
    { key: "MOKA", label: "摩卡壺", enabled: true },
    { key: "DRIP_MACHINE", label: "美式咖啡機", enabled: true },
    { key: "OTHER", label: "其他（備註說明）", enabled: true },
  ],
  minShelfDaysAtShip: 14,
  maxQtyPerLine: 20,
  service: { email: "", phone: "", lineUrl: "", hours: "" },
  social: { instagram: "", facebook: "", line: "" },
  business: { name: "", taxId: "", address: "", foodRegNo: "", phone: "" },
};
type S = typeof DEFAULT;
const WD = ["日", "一", "二", "三", "四", "五", "六"];

export default function StoreSettings() {
  const doc = useDocument("settings", "store");
  const [s, setS] = useState<S | null>(null);
  const [dates, setDates] = useState("");
  useEffect(() => {
    if (doc.loading || s) return;
    const d = (doc.data ?? {}) as Partial<S>;
    const m: S = { ...DEFAULT, ...d, bank: { ...DEFAULT.bank, ...d.bank }, shipping: { ...DEFAULT.shipping, ...d.shipping }, service: { ...DEFAULT.service, ...d.service }, social: { ...DEFAULT.social, ...d.social }, business: { ...DEFAULT.business, ...d.business } } as S;
    setS(m);
    setDates((m.nonShipDates ?? []).join("\n"));
  }, [doc.loading, doc.data, s]);
  if (!s) return <Loading />;
  const up = <K extends keyof S>(k: K, v: S[K]) => setS({ ...s, [k]: v });
  const sub = <K extends "bank" | "shipping" | "service" | "social" | "business">(k: K, f: string, v: unknown) => setS({ ...s, [k]: { ...s[k], [f]: v } });
  // 用函式產生欄位（不是元件），避免每次輸入重新掛載而失去焦點
  const T = ({ k, f, label, ph }: { k: "bank" | "shipping" | "service" | "social" | "business"; f: string; label: string; ph?: string }) => (
    <label key={`${k}.${f}`} className={labelCls}>
      {label}
      <input className={inputCls} value={String((s[k] as Record<string, unknown>)[f] ?? "")} placeholder={ph} onChange={(e) => sub(k, f, e.target.value)} />
    </label>
  );
  const save = async () => {
    const r = await callOp("store.settings.save", {
      ...s,
      nonShipDates: dates.split(/\s+/).filter(Boolean),
      paymentDeadlineHours: Number(s.paymentDeadlineHours),
      paymentReminderHours: Number(s.paymentReminderHours),
      prepDays: Number(s.prepDays),
      minShelfDaysAtShip: Number(s.minShelfDaysAtShip),
      maxQtyPerLine: Number(s.maxQtyPerLine),
    });
    toast(r.ok ? "已儲存商城設定" : r.error, r.ok ? "success" : "error");
  };
  return (
    <>
      <PageHeader title="商城設定" description="收款帳戶、付款期限、運費、出貨日、研磨方式、客服與業者資訊" actions={<Button onClick={save}>儲存</Button>} />
      <div className="grid gap-4">
        <Card>
          <CardHeader title="營業狀態" />
          <CardBody className="grid gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={s.open} onChange={(e) => up("open", e.target.checked)} className="accent-[var(--primary)]" />
              開放接單（關閉後顧客仍可瀏覽，但無法下單）
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={s.maintenance} onChange={(e) => up("maintenance", e.target.checked)} className="accent-[var(--primary)]" />
              維護模式（商城只顯示維護畫面；訂單查詢仍可使用）
            </label>
            <label className={labelCls}>
              維護說明
              <input className={inputCls} value={s.maintenanceMessage} onChange={(e) => up("maintenanceMessage", e.target.value)} />
            </label>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="收款帳戶（銀行轉帳）" description="訂單成立時會保存當下的帳戶資訊；之後修改不影響已成立的訂單" />
          <CardBody className="grid gap-3 md:grid-cols-3">
            {s.bank.isDemo && (
              <div className="md:col-span-3">
                <Notice tone="warning">目前是示範帳戶。填入正式帳戶後取消勾選「示範」。</Notice>
              </div>
            )}
            {T({ k: "bank", f: "bankName", label: "銀行名稱" })}
            {T({ k: "bank", f: "bankCode", label: "銀行代碼", ph: "例：812" })}
            {T({ k: "bank", f: "branch", label: "分行（選填）" })}
            {T({ k: "bank", f: "accountNo", label: "帳號" })}
            {T({ k: "bank", f: "accountName", label: "戶名" })}
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={s.bank.isDemo} onChange={(e) => sub("bank", "isDemo", e.target.checked)} className="accent-[var(--primary)]" />
              示範帳戶（前台會標示請勿匯款）
            </label>
            <label className={labelCls}>
              付款期限（下單後幾小時）
              <input className={inputCls} type="number" value={s.paymentDeadlineHours} onChange={(e) => up("paymentDeadlineHours", Number(e.target.value))} />
            </label>
            <label className={labelCls}>
              到期前幾小時寄提醒（0＝不寄）
              <input className={inputCls} type="number" value={s.paymentReminderHours} onChange={(e) => up("paymentReminderHours", Number(e.target.value))} />
            </label>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="運費與物流" description="目前使用人工物流（顧客填寫官方門市查詢的店號，後台人工寄件並輸入物流單號）" />
          <CardBody className="grid gap-3 md:grid-cols-3">
            {T({ k: "shipping", f: "fee", label: "固定運費（元）" })}
            {T({ k: "shipping", f: "freeThreshold", label: "滿額免運門檻（元，留空＝不免運）" })}
            <label className={labelCls}>
              免運判斷金額
              <select className={inputCls} value={s.shipping.freeBasis} onChange={(e) => sub("shipping", "freeBasis", e.target.value)}>
                <option value="AFTER_ITEM_DISCOUNT">折扣後商品金額</option>
                <option value="SUBTOTAL">折扣前商品小計</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={s.shipping.isDemo} onChange={(e) => sub("shipping", "isDemo", e.target.checked)} className="accent-[var(--primary)]" />
              示範運費（尚未決定正式金額）
            </label>
            {s.pickupChannels.map((c, i) => (
              <label key={c.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={c.enabled} onChange={(e) => up("pickupChannels", s.pickupChannels.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} className="accent-[var(--primary)]" />
                {c.label} 取貨
              </label>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="出貨與品質" />
          <CardBody className="grid gap-3 md:grid-cols-3">
            <label className={labelCls}>
              備貨天數（工作天）
              <input className={inputCls} type="number" value={s.prepDays} onChange={(e) => up("prepDays", Number(e.target.value))} />
            </label>
            <label className={labelCls}>
              出貨時距離賞味期限至少（天）
              <input className={inputCls} type="number" value={s.minShelfDaysAtShip} onChange={(e) => up("minShelfDaysAtShip", Number(e.target.value))} />
            </label>
            <label className={labelCls}>
              每項商品一次最多可買
              <input className={inputCls} type="number" value={s.maxQtyPerLine} onChange={(e) => up("maxQtyPerLine", Number(e.target.value))} />
            </label>
            <fieldset className="md:col-span-3">
              <legend className="mb-1 text-xs text-muted">不出貨的星期</legend>
              <div className="flex flex-wrap gap-3">
                {WD.map((w, i) => (
                  <label key={i} className="flex items-center gap-1 text-sm">
                    <input type="checkbox" checked={s.nonShipWeekdays.includes(i)} onChange={(e) => up("nonShipWeekdays", e.target.checked ? [...s.nonShipWeekdays, i] : s.nonShipWeekdays.filter((x) => x !== i))} className="accent-[var(--primary)]" />
                    週{w}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className={`${labelCls} md:col-span-3`}>
              不出貨的日期（每行一個 YYYY-MM-DD，例如連假）
              <textarea className={`${inputCls} h-20 py-2`} value={dates} onChange={(e) => setDates(e.target.value)} />
            </label>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="研磨方式" description="顧客選擇免費代客研磨時可選的沖煮方式" />
          <CardBody className="grid gap-2">
            {s.grindOptions.map((g, i) => (
              <div key={g.key} className="flex items-center gap-3">
                <input type="checkbox" checked={g.enabled} onChange={(e) => up("grindOptions", s.grindOptions.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} className="accent-[var(--primary)]" aria-label={`啟用 ${g.label}`} />
                <input className={`${inputCls} max-w-xs`} value={g.label} onChange={(e) => up("grindOptions", s.grindOptions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="客服與社群" />
          <CardBody className="grid gap-3 md:grid-cols-2">
            {T({ k: "service", f: "email", label: "客服 Email" })}
            {T({ k: "service", f: "phone", label: "客服電話" })}
            {T({ k: "service", f: "lineUrl", label: "LINE 官方帳號連結" })}
            {T({ k: "service", f: "hours", label: "服務時間" })}
            {T({ k: "social", f: "instagram", label: "Instagram 網址" })}
            {T({ k: "social", f: "facebook", label: "Facebook 網址" })}
            {T({ k: "social", f: "line", label: "LINE 網址" })}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="業者資訊（法規揭露，顯示在商城頁尾）" description="請填寫正式登記資料；未填寫的項目前台顯示「待補」" />
          <CardBody className="grid gap-3 md:grid-cols-2">
            {T({ k: "business", f: "name", label: "業者名稱" })}
            {T({ k: "business", f: "taxId", label: "統一編號" })}
            {T({ k: "business", f: "address", label: "營業地址" })}
            {T({ k: "business", f: "phone", label: "聯絡電話" })}
            {T({ k: "business", f: "foodRegNo", label: "食品業者登錄字號" })}
          </CardBody>
        </Card>
        <div>
          <Button onClick={save}>儲存</Button>
        </div>
      </div>
    </>
  );
}
