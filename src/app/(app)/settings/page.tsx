"use client";

import { useEffect, useState } from "react";
import { EmailAuthProvider, GoogleAuthProvider, linkWithPopup, reauthenticateWithCredential, unlink, updatePassword } from "firebase/auth";
import { googleErrorMessage, googleProvider } from "@/lib/google-auth";
import { NotifySettings } from "./notify";
import { collection, getDocs } from "firebase/firestore";
import { getBlob, ref, uploadBytes } from "firebase/storage";
import { fmtNum } from "@/lib/decimal";
import { fmtDateTime } from "@/lib/time";
import { EQUIPMENT_TYPE, MATERIAL_CATEGORY } from "@/lib/labels";
import { callOp, opAction } from "@/lib/api";
import { fb } from "@/lib/firebase";
import { useCol, useDocument, type Row } from "@/lib/data";
import { useQS } from "@/lib/page";
import { downloadBlob, downloadCsv } from "@/lib/csv";
import { useAuth } from "@/components/auth";
import { ActionDialog, type DialogField } from "@/components/action-dialog";
import { MascotPlaceholder } from "@/components/brand";
import { DataTable } from "@/components/data-table";
import { EntityForm } from "@/components/entity-form";
import { toast } from "@/components/toast";
import { Badge, Button, Card, CardBody, CardHeader, LinkButton, Notice, PageHeader, SimpleTable, Tabs } from "@/components/ui";

const SECTIONS = [
  ["account", "個人帳號"],
  ["roasters", "烘豆機"],
  ["suppliers", "供應商"],
  ["equipment", "沖煮器材"],
  ["templates", "評分模板"],
  ["materials", "包材品項"],
  ["locations", "儲位"],
  ["defaults", "系統預設與預警"],
  ["notify", "通知"],
  ["brand", "品牌素材"],
  ["data", "匯出與備份"],
  ["admins", "管理員"],
  ["api", "前台 API"],
  ["audit", "操作紀錄"],
] as const;
const s = (v: unknown) => (v == null ? "" : String(v));

export default function SettingsPage() {
  const sec = useQS("s") ?? "account";
  const section = SECTIONS.some(([k]) => k === sec) ? sec : "account";
  return (
    <>
      <PageHeader title="系統設定" description="管理員名單與角色（ADMIN／STAFF／VIEWER）已預留擴充" />
      <Tabs active={section} tabs={SECTIONS.map(([key, label]) => ({ key, label, href: `/settings/?s=${key}` }))} />
      <Section section={section} />
    </>
  );
}

function Section({ section }: { section: string }) {
  switch (section) {
    case "account":
      return <Account />;
    case "roasters":
      return <Roasters />;
    case "suppliers":
      return <Master col="suppliers" op="supplier.save" title="供應商" head={["代碼", "名稱", "聯絡人", "電話", "國家"]} row={(x) => [x.code, x.name, x.contact ?? "—", x.phone ?? "—", x.country ?? "—"]} fields={(x) => [{ name: "code", label: "代碼", required: true, defaultValue: s(x?.code) }, { name: "name", label: "名稱", required: true, defaultValue: s(x?.name) }, { name: "contact", label: "聯絡人", defaultValue: s(x?.contact) }, { name: "phone", label: "電話", defaultValue: s(x?.phone) }, { name: "email", label: "Email", defaultValue: s(x?.email) }, { name: "country", label: "國家", defaultValue: s(x?.country) }, { name: "note", label: "備註", type: "textarea", defaultValue: s(x?.note) }]} />;
    case "equipment":
      return <Master col="equipment" op="equipment.save" title="沖煮器材" desc="研磨機、濾杯、濾紙等主檔" head={["類型", "名稱", "品牌", "型號"]} row={(x) => [EQUIPMENT_TYPE[x.type], x.name, x.brand ?? "—", x.model ?? "—"]} fields={(x) => [{ name: "type", label: "類型", type: "select", options: Object.entries(EQUIPMENT_TYPE).map(([value, label]) => ({ value, label })), defaultValue: s(x?.type) }, { name: "name", label: "名稱", required: true, defaultValue: s(x?.name) }, { name: "brand", label: "品牌", defaultValue: s(x?.brand) }, { name: "model", label: "型號", defaultValue: s(x?.model) }, { name: "note", label: "備註", type: "textarea", defaultValue: s(x?.note) }]} />;
    case "materials":
      return <Master col="materials" op="material.save" title="包材品項" desc="入庫請至庫存中心 → 包材" extra={<LinkButton href="/inventory/?kind=MATERIAL" size="sm" variant="ghost">包材庫存</LinkButton>} head={["代碼", "名稱", "類別", "規格"]} row={(x) => [x.code, x.name, MATERIAL_CATEGORY[x.category], x.spec ?? "—"]} fields={(x) => [{ name: "code", label: "代碼", required: true, defaultValue: s(x?.code) }, { name: "name", label: "名稱", required: true, defaultValue: s(x?.name) }, { name: "category", label: "類別", type: "select", options: Object.entries(MATERIAL_CATEGORY).map(([value, label]) => ({ value, label })), defaultValue: s(x?.category) }, { name: "spec", label: "規格", defaultValue: s(x?.spec) }, { name: "note", label: "備註", type: "textarea", defaultValue: s(x?.note) }]} />;
    case "locations":
      return <Master col="locations" op="location.save" title="儲位" head={["代碼", "名稱", "備註"]} row={(x) => [x.code, x.name, x.note ?? "—"]} fields={(x) => [{ name: "code", label: "代碼", required: true, defaultValue: s(x?.code) }, { name: "name", label: "名稱", required: true, defaultValue: s(x?.name) }, { name: "note", label: "備註", defaultValue: s(x?.note) }]} />;
    case "templates":
      return <Templates />;
    case "notify":
      return <NotifySettings />;
    case "defaults":
      return <Defaults />;
    case "brand":
      return <Brand />;
    case "data":
      return <DataExport />;
    case "admins":
      return <Admins />;
    case "api":
      return <ApiKeys />;
    case "audit":
      return <Audit />;
  }
  return null;
}

function Master({ col, op, title, desc, head, row, fields, extra }: { col: string; op: string; title: string; desc?: string; head: string[]; row: (x: Row) => React.ReactNode[]; fields: (x?: Row) => DialogField[]; extra?: React.ReactNode }) {
  const d = useCol(col, [], "createdAt", false);
  return (
    <Card>
      <CardHeader title={title} description={desc} action={<>{extra}<ActionDialog label="＋ 新增" size="sm" title={`新增${title}`} fields={fields()} action={opAction(op)} /></>} />
      <SimpleTable head={[...head, ""]} rows={d.data.map((x) => [...row(x), <ActionDialog key="e" label="編輯" size="sm" variant="ghost" title={`編輯${title}`} payload={{ id: x.id }} fields={fields(x)} action={opAction(op)} />])} empty={d.loading ? "載入中…" : "尚無資料"} />
    </Card>
  );
}

function Account() {
  return (
    <div className="grid gap-6">
      <GoogleLink />
      <PasswordCard />
    </div>
  );
}

/** 綁定 Google：同一個帳號（同一 uid、同樣的管理員權限）可用密碼或 Google 登入 */
function GoogleLink() {
  const { user } = useAuth();
  const [providers, setProviders] = useState<string[]>(() => user?.providerData.map((p) => p.providerId) ?? []);
  const [busy, setBusy] = useState(false);
  const google = user?.providerData.find((p) => p.providerId === GoogleAuthProvider.PROVIDER_ID);
  const linked = providers.includes(GoogleAuthProvider.PROVIDER_ID);
  const hasPassword = providers.includes("password");
  const refresh = () => setProviders(user?.providerData.map((p) => p.providerId) ?? []);
  const link = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await linkWithPopup(user, googleProvider());
      await user.reload();
      refresh();
      toast("已綁定 Google 帳號，之後可直接用 Google 登入");
    } catch (e) {
      const m = googleErrorMessage(e);
      if (m) toast(m, "error");
    } finally {
      setBusy(false);
    }
  };
  const doUnlink = async () => {
    if (!user || !confirm("解除綁定後將無法再用此 Google 帳號登入，確定嗎？")) return;
    setBusy(true);
    try {
      await unlink(user, GoogleAuthProvider.PROVIDER_ID);
      await user.reload();
      refresh();
      toast("已解除 Google 綁定");
    } catch (e) {
      toast(googleErrorMessage(e) ?? "解除綁定失敗", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Google 帳號" description="綁定後可在登入頁按「使用 Google 登入」，權限與目前帳號相同；未綁定的 Google 帳號無法進入後台。" action={linked ? <Badge tone="sage">已綁定</Badge> : <Badge>未綁定</Badge>} />
      <CardBody className="flex flex-wrap items-center gap-3 text-sm">
        {linked ? (
          <>
            <span>{google?.email ?? "已綁定 Google"}</span>
            {hasPassword ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={doUnlink}>
                解除綁定
              </Button>
            ) : (
              <span className="text-xs text-muted">（此帳號沒有設定密碼，為避免無法登入，不能解除綁定）</span>
            )}
          </>
        ) : (
          <Button disabled={busy} onClick={link}>
            {busy ? "處理中…" : "綁定 Google 帳號"}
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

function PasswordCard() {
  const { user, admin } = useAuth();
  return (
    <Card>
      <CardHeader title="個人帳號" description={`${user?.email}・角色：${admin?.role}`} />
      <CardBody>
        <form
          className="grid max-w-md gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const cur = String(fd.get("current"));
            const next = String(fd.get("next"));
            if (next.length < 12) return toast("新密碼至少 12 個字元", "error");
            try {
              await reauthenticateWithCredential(user!, EmailAuthProvider.credential(user!.email!, cur));
              await updatePassword(user!, next);
              toast("密碼已更新");
              (e.target as HTMLFormElement).reset();
            } catch {
              toast("目前密碼不正確或需要重新登入", "error");
            }
          }}
        >
          <label className="text-xs text-muted">目前密碼<input name="current" type="password" required autoComplete="current-password" className="mt-1 h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm text-fg" /></label>
          <label className="text-xs text-muted">新密碼（至少 12 字元）<input name="next" type="password" required autoComplete="new-password" className="mt-1 h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm text-fg" /></label>
          <Button type="submit" className="w-fit">變更密碼</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function Roasters() {
  const r = useCol("roasters", [], "name", false);
  const f = (x?: Row): DialogField[] => [
    { name: "name", label: "名稱", required: true, defaultValue: s(x?.name) },
    { name: "brand", label: "品牌", required: true, defaultValue: s(x?.brand ?? "Olomo") },
    { name: "model", label: "型號", required: true, defaultValue: s(x?.model) },
    { name: "maxCapacityG", label: "最大容量（g）", type: "number", defaultValue: s(x?.maxCapacityG) },
    { name: "tempChannels", label: "可用溫度通道（以逗號分隔，例：BT,ET）", defaultValue: (x?.tempChannels as string[])?.join(",") ?? "BT,ET" },
    { name: "heatControl", label: "火力設定方式", defaultValue: s(x?.heatControl) },
    { name: "airflowControl", label: "風門設定方式", defaultValue: s(x?.airflowControl) },
    { name: "drumSpeedControl", label: "轉速設定方式", defaultValue: s(x?.drumSpeedControl) },
    { name: "sensorNote", label: "感測器設定", type: "textarea", defaultValue: s(x?.sensorNote) },
    { name: "note", label: "備註", type: "textarea", defaultValue: s(x?.note) },
  ];
  return (
    <Card>
      <CardHeader title="烘豆機" description="支援 Olomo，但不綁定機型；未提供的通道在烘焙表單中為選填" action={<ActionDialog label="＋ 新增烘豆機" size="sm" title="新增烘豆機" fields={f()} action={opAction("roaster.save")} />} />
      <SimpleTable head={["名稱", "品牌／型號", "容量", "溫度通道", "火力／風門／轉速", ""]} rows={r.data.map((x) => [x.name, `${x.brand} ${x.model}`, x.maxCapacityG ? `${fmtNum(x.maxCapacityG, 0)} g` : "—", (x.tempChannels ?? []).join("、") || "—", [x.heatControl, x.airflowControl, x.drumSpeedControl].map((y) => y ?? "—").join("／"), <ActionDialog key="e" label="編輯" size="sm" variant="ghost" title="編輯烘豆機" payload={{ id: x.id }} fields={f(x)} action={opAction("roaster.save")} />])} />
    </Card>
  );
}

function Templates() {
  const t = useCol("cuppingTemplates", [], "createdAt", false);
  const sessions = useCol("cuppingSessions");
  return (
    <Card>
      <CardHeader
        title="杯測評分模板"
        description="自訂評分系統，明確標示非 SCA 官方標準。已使用的模板請勿變更評分項目，請建立新模板。"
        action={<ActionDialog label="＋ 新增模板" size="sm" title="新增評分模板" fields={[{ name: "name", label: "名稱", required: true }, { name: "description", label: "說明", defaultValue: "ATA Coffee 自訂評分（非 SCA 官方）" }, { name: "scaleMin", label: "最低分", type: "number", defaultValue: "0" }, { name: "scaleMax", label: "最高分", type: "number", defaultValue: "10" }, { name: "step", label: "間距", type: "number", defaultValue: "0.25" }, { name: "attributes", label: "評分項目（每行 代碼:名稱）", type: "textarea", required: true, defaultValue: "fragrance:乾香\naroma:濕香\nacidity:酸質\nsweetness:甜感\nbody:醇厚度\nbalance:平衡\naftertaste:尾韻\noverall:整體評價" }, { name: "isDefault", label: "設為預設", type: "select", options: [{ value: "false", label: "否" }, { value: "true", label: "是" }] }]} action={opAction("template.create")} />}
      />
      <SimpleTable head={["名稱", "分數範圍", "評分項目", "使用次數", ""]} rows={t.data.map((x) => [x.name, `${x.scaleMin}–${x.scaleMax}（間距 ${x.step}）`, (x.attributes as Row[]).map((a) => a.label).join("、"), sessions.data.filter((q) => q.templateId === x.id).length, x.isDefault ? <Badge key="d" tone="primary">預設</Badge> : ""])} />
    </Card>
  );
}

function Defaults() {
  const tax = useDocument("settings", "tax");
  const order = useDocument("settings", "order");
  const inv = useDocument("settings", "inventory");
  if (tax.loading || order.loading || inv.loading) return <p className="text-sm text-muted">載入中…</p>;
  return (
    <EntityForm
      submitLabel="儲存預設值"
      defaultValues={{ taxMode: tax.data?.mode ?? "INCLUSIVE", taxRate: tax.data?.rate ?? "0.05", requirePaymentBeforeShip: String(order.data?.requirePaymentBeforeShip ?? true), lowGreenG: String(inv.data?.lowGreenG ?? 3000), lowRoastedG: String(inv.data?.lowRoastedG ?? 500), lowFinishedPcs: String(inv.data?.lowFinishedPcs ?? 5), expiryWarnDays: String(inv.data?.expiryWarnDays ?? 14) }}
      sections={[{ key: "a", title: "稅務與訂單", description: "變更只影響之後建立的訂單；歷史訂單保留當時的稅務設定快照。本系統非正式稅務申報系統。" }, { key: "b", title: "庫存預警" }]}
      fields={[
        { name: "taxMode", label: "稅務處理方式", type: "select", required: true, options: [{ value: "INCLUSIVE", label: "售價含稅（內含）" }, { value: "EXCLUSIVE", label: "售價未稅（外加）" }, { value: "NONE", label: "不計稅" }], section: "a" },
        { name: "taxRate", label: "營業稅率（小數）", type: "number", hint: "5% 請填 0.05", section: "a" },
        { name: "requirePaymentBeforeShip", label: "出貨前必須確認付款", type: "select", required: true, options: [{ value: "true", label: "是" }, { value: "false", label: "否（允許貨到付款等）" }], section: "a" },
        { name: "lowGreenG", label: "生豆預警（每品項）", type: "number", unit: "g", section: "b" },
        { name: "lowRoastedG", label: "熟豆預警（每品項）", type: "number", unit: "g", section: "b" },
        { name: "lowFinishedPcs", label: "成品預警（每品項）", type: "number", unit: "件", section: "b" },
        { name: "expiryWarnDays", label: "有效日期提醒（天內）", type: "number", unit: "天", section: "b" },
      ]}
      action={opAction("settings.save")}
    />
  );
}

function BrandImg({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    getBlob(ref(fb().storage, path)).then((b) => setUrl(URL.createObjectURL(b))).catch(() => setUrl(null));
  }, [path]);
  return url ? <img src={url} alt={alt} className="h-12 w-12 rounded object-contain" /> : <span className="text-xs text-muted">—</span>;
}

function Brand() {
  const assets = useCol("brandAssets", [], "createdAt");
  const [pending, setPending] = useState(false);
  return (
    <div className="grid gap-6">
      <Notice tone="warning">ATA Coffee 正式 Logo 與 Ati／Ato 吉祥物尚未上傳。系統目前使用清楚標示的佔位圖，不代表官方設計。</Notice>
      <Card>
        <CardHeader title="目前佔位" />
        <CardBody className="grid max-w-md grid-cols-3 gap-4">
          <div className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-accent text-xs text-muted">Logo 佔位</div>
          <MascotPlaceholder name="Ati" />
          <MascotPlaceholder name="Ato" />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="上傳品牌素材" description="檔案類型與大小由 Storage 安全規則在伺服器端驗證；只有勾選「正式官方素材」的檔案會被視為官方版本" />
        <CardBody>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              const f = fd.get("file") as File;
              const ext = f?.name.toLowerCase().split(".").pop() ?? "";
              if (!f || !["jpg", "jpeg", "png", "webp"].includes(ext)) return toast("請選擇 JPG／PNG／WebP 圖片", "error");
              if (f.size > 5 * 1024 * 1024) return toast("檔案過大（上限 5MB）", "error");
              setPending(true);
              try {
                const path = `brand/${crypto.randomUUID()}.${ext}`;
                await uploadBytes(ref(fb().storage, path), f, { contentType: f.type });
                const r = await callOp("brand.register", { kind: fd.get("kind"), name: String(fd.get("name") || f.name), storagePath: path, isOfficial: fd.get("isOfficial") === "on" });
                if (!r.ok) throw new Error(r.error);
                toast("已上傳");
                form.reset();
              } catch (err) {
                toast((err as Error).message || "上傳失敗", "error");
              } finally {
                setPending(false);
              }
            }}
          >
            <label className="text-xs text-muted">類型<select name="kind" className="mt-1 h-10 w-full rounded-lg border border-border bg-bg px-2 text-sm text-fg"><option value="LOGO">Logo</option><option value="MASCOT_ATI">吉祥物 Ati</option><option value="MASCOT_ATO">吉祥物 Ato</option><option value="PACKAGING">包裝設計</option><option value="OTHER">其他</option></select></label>
            <label className="text-xs text-muted">名稱<input name="name" className="mt-1 h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm text-fg" /></label>
            <label className="text-xs text-muted">圖片（5MB 內）<input name="file" type="file" accept=".jpg,.jpeg,.png,.webp" required className="mt-1 block w-full text-sm" /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isOfficial" className="accent-[var(--primary)]" /> 這是 ATA 正式官方素材</label>
            <Button type="submit" disabled={pending}>{pending ? "上傳中…" : "上傳"}</Button>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="素材庫" />
        <SimpleTable head={["預覽", "類型", "名稱", "官方", "上傳時間"]} rows={assets.data.map((a) => [<BrandImg key="i" path={a.storagePath} alt={a.name} />, ({ LOGO: "Logo", MASCOT_ATI: "Ati", MASCOT_ATO: "Ato", PACKAGING: "包裝", OTHER: "其他" } as Record<string, string>)[a.kind], a.name, a.isOfficial ? <Badge key="o" tone="sage">官方</Badge> : <Badge key="o">非官方／暫用</Badge>, fmtDateTime(a.createdAt)])} empty="尚未上傳" />
      </Card>
    </div>
  );
}

const EXPORTS: Array<[string, string]> = [
  ["coffees", "咖啡豆主檔"],
  ["greenLots", "生豆採購批次"],
  ["roastBatches", "烘焙批次"],
  ["cuppingSessions", "杯測紀錄"],
  ["brewSessions", "手沖紀錄"],
  ["invTxs", "庫存帳本"],
  ["invLots", "庫存批次餘額"],
  ["orders", "訂單"],
  ["orderItems", "訂單明細"],
  ["variants", "商品品項"],
  ["customers", "顧客（含個資，請妥善保管）"],
];
const ALL_COLLECTIONS = ["admins", "auditLogs", "settings", "sequences", "uniq", "suppliers", "coffees", "greenPurchases", "greenLots", "roasters", "roastBatches", "roastCurves", "flavorTags", "cuppingTemplates", "cuppingSessions", "equipment", "brewRecipes", "brewSessions", "researchProjects", "locations", "materials", "invItems", "invLots", "invTxs", "invTxReversals", "reservations", "productionOrders", "packagingBatches", "brandSeries", "products", "variants", "customers", "orders", "orderItems", "allocations", "payments", "returns", "costEntries", "costRules", "traces", "brandAssets"];

function DataExport() {
  const [busy, setBusy] = useState<string | null>(null);
  const grab = async (col: string) => (await getDocs(collection(fb().db, col))).docs.map((d) => ({ id: d.id, ...d.data() }));
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title="資料匯出（CSV，UTF-8 BOM，Excel 可直接開啟）" />
        <CardBody className="flex flex-wrap gap-2">
          {EXPORTS.map(([k, l]) => (
            <Button key={k} variant="outline" size="sm" disabled={busy === k} onClick={async () => { setBusy(k); downloadCsv(k, await grab(k)); setBusy(null); }}>
              ⬇ {l}
            </Button>
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="完整備份（JSON）" description="下載所有集合的完整 JSON 快照，建議每週存到離線位置。正式環境另應啟用 Firestore 排程備份（見部署文件）。" />
        <CardBody>
          <Button
            disabled={busy === "all"}
            onClick={async () => {
              setBusy("all");
              const out: Record<string, unknown[]> = {};
              for (const c of ALL_COLLECTIONS) out[c] = await grab(c);
              downloadBlob(`ata-backup-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.json`, new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), collections: out }, null, 1)], { type: "application/json" }));
              setBusy(null);
              toast("備份檔已下載");
            }}
          >
            {busy === "all" ? "匯出中…" : "下載完整備份"}
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

function Admins() {
  const a = useCol("admins", [], "createdAt", false);
  return (
    <div className="grid gap-6">
      <Notice>新增管理員：先在 Firebase Console → Authentication 建立使用者（Email／密碼由該使用者自行設定），再把該使用者的 UID 加入下方名單。</Notice>
      <Card>
        <CardHeader title="管理員名單" action={<ActionDialog label="＋ 新增管理員" size="sm" title="新增管理員" fields={[{ name: "uid", label: "使用者 UID", required: true }, { name: "email", label: "Email", required: true }, { name: "name", label: "名稱", required: true }]} action={opAction("admin.add")} />} />
        <SimpleTable head={["名稱", "Email", "角色", "UID", "加入時間"]} rows={a.data.map((x) => [x.name, x.email, x.role, <code key="u" className="text-xs">{x.id}</code>, fmtDateTime(x.createdAt)])} />
      </Card>
    </div>
  );
}

function ApiKeys() {
  const k = useCol("apiKeys", [], "createdAt");
  return (
    <div className="grid gap-6">
      <Notice>未來官網應由「官網後端伺服器」以 API 金鑰呼叫 Cloud Function storefront（POST /orders、GET /products）。金鑰只能放在伺服器環境變數，不可放入瀏覽器。官網無法直接修改庫存，訂單一律經由同一套訂單邏輯。</Notice>
      <Card>
        <CardHeader title="API 金鑰" action={<ActionDialog label="＋ 建立金鑰" size="sm" title="建立 API 金鑰" description="金鑰只會顯示一次，資料庫僅保存雜湊值。" fields={[{ name: "name", label: "用途名稱", required: true, defaultValue: "官網" }]} action={opAction("apikey.create")} />} />
        <SimpleTable head={["名稱", "前綴", "權限", "建立", "最後使用", "狀態", ""]} rows={k.data.map((x) => [x.name, <code key="p">{x.prefix}…</code>, (x.scopes ?? []).join(", "), fmtDateTime(x.createdAt), fmtDateTime(x.lastUsedAt), x.revokedAt ? <Badge key="r">已撤銷</Badge> : <Badge key="r" tone="sage">有效</Badge>, x.revokedAt ? "" : <ActionDialog key="x" label="撤銷" size="sm" variant="ghost" title="撤銷此金鑰？" payload={{ id: x.id }} action={opAction("apikey.revoke")} />])} empty="尚未建立" />
      </Card>
    </div>
  );
}

function Audit() {
  const logs = useCol("auditLogs", [], "createdAt");
  return (
    <DataTable
      pageSize={50}
      columns={[
        { key: "time", label: "時間", sortable: true },
        { key: "actor", label: "操作者" },
        { key: "action", label: "動作" },
        { key: "entity", label: "對象", hideOnMobile: true },
        { key: "summary", label: "摘要" },
      ]}
      filters={[{ key: "entity", label: "對象類型", options: [...new Set(logs.data.map((l) => l.entityType as string))].map((v) => ({ value: v, label: v })) }]}
      rows={logs.data.map((l) => ({ id: l.id, search: [l.action, l.entityType, l.summary, l.actorName].join(" "), filters: { entity: l.entityType }, sort: { time: l.createdAt }, cells: { time: fmtDateTime(l.createdAt), actor: l.actorName ?? "系統", action: <code className="text-xs">{l.action}</code>, entity: l.entityType, summary: l.summary ?? "—" } }))}
    />
  );
}
