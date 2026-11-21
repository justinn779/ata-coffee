import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { fmtNum } from "@/lib/decimal";
import { fmtDateTime } from "@/lib/time";
import { EQUIPMENT_TYPE, MATERIAL_CATEGORY } from "@/lib/labels";
import { getCurrentUser } from "@/server/auth";
import { getSettings } from "@/server/domain/settings";
import { ActionDialog, type DialogField } from "@/components/action-dialog";
import { MascotPlaceholder } from "@/components/brand";
import { DataTable } from "@/components/data-table";
import { EntityForm } from "@/components/entity-form";
import { A, Badge, Card, CardBody, CardHeader, LinkButton, Notice, PageHeader, SimpleTable, Tabs } from "@/components/ui";
import { BrandUpload } from "../brand-upload";
import {
  createApiKey,
  revokeApiKey,
  saveDefaults,
  saveEquipment,
  saveFlavorTag,
  saveLocation,
  saveMaterial,
  saveRoaster,
  saveSupplier,
  saveTemplate,
  updateAccount,
} from "../actions";

const SECTIONS = [
  ["account", "個人帳號"],
  ["roasters", "烘豆機"],
  ["suppliers", "供應商"],
  ["equipment", "沖煮器材"],
  ["flavors", "風味詞彙"],
  ["templates", "評分模板"],
  ["materials", "包材品項"],
  ["locations", "儲位"],
  ["defaults", "系統預設與預警"],
  ["brand", "品牌素材"],
  ["data", "匯入匯出與備份"],
  ["api", "前台 API"],
  ["audit", "操作紀錄"],
] as const;

export const metadata = { title: "系統設定" };
const s = (v: unknown) => (v == null ? "" : String(v));

export default async function SettingsSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!SECTIONS.some(([k]) => k === section)) notFound();
  return (
    <>
      <PageHeader title="系統設定" description="目前為單一管理員；資料結構已預留角色（ADMIN／STAFF／VIEWER）擴充" />
      <Tabs active={section} tabs={SECTIONS.map(([key, label]) => ({ key, label, href: `/settings/${key}` }))} />
      <Section section={section} />
    </>
  );
}

async function Section({ section }: { section: string }) {
  switch (section) {
    case "account": {
      const u = (await getCurrentUser())!;
      return (
        <EntityForm
          submitLabel="更新帳號"
          defaultValues={{ name: u.name }}
          fields={[
            { name: "name", label: "顯示名稱", required: true },
            { name: "currentPassword", label: "目前密碼（變更密碼時必填）", type: "password" },
            { name: "newPassword", label: "新密碼（至少 12 字元）", type: "password" },
          ]}
          action={updateAccount}
          footer={<span className="text-xs text-muted">帳號：{u.email}・角色：{u.role}・上次登入：{fmtDateTime(u.lastLoginAt)}</span>}
        />
      );
    }
    case "roasters": {
      const rs = await prisma.roasterProfile.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { batches: true } } } });
      const f = (r?: (typeof rs)[number]): DialogField[] => [
        { name: "name", label: "名稱", required: true, defaultValue: s(r?.name) },
        { name: "brand", label: "品牌", required: true, defaultValue: s(r?.brand ?? "Olomo") },
        { name: "model", label: "型號", required: true, defaultValue: s(r?.model) },
        { name: "maxCapacityG", label: "最大容量（g）", type: "number", defaultValue: s(r?.maxCapacityG) },
        { name: "tempChannels", label: "可用溫度通道（以逗號分隔，例：BT,ET）", defaultValue: r?.tempChannels.join(",") ?? "BT,ET" },
        { name: "heatControl", label: "火力設定方式", defaultValue: s(r?.heatControl) },
        { name: "airflowControl", label: "風門設定方式", defaultValue: s(r?.airflowControl) },
        { name: "drumSpeedControl", label: "轉速設定方式", defaultValue: s(r?.drumSpeedControl) },
        { name: "sensorNote", label: "感測器設定", type: "textarea", defaultValue: s((r?.sensorConfig as { note?: string } | null)?.note) },
        { name: "note", label: "備註", type: "textarea", defaultValue: s(r?.note) },
      ];
      return (
        <Card>
          <CardHeader title="烘豆機" description="支援 Olomo，但不綁定機型；未提供的通道在烘焙表單中為選填" action={<ActionDialog label="＋ 新增烘豆機" size="sm" title="新增烘豆機" fields={f()} action={saveRoaster} />} />
          <SimpleTable head={["名稱", "品牌／型號", "容量", "溫度通道", "火力／風門／轉速", "批次數", ""]} rows={rs.map((r) => [r.name, `${r.brand} ${r.model}`, r.maxCapacityG ? `${fmtNum(r.maxCapacityG, 0)} g` : "—", r.tempChannels.join("、") || "—", [r.heatControl, r.airflowControl, r.drumSpeedControl].map((x) => x ?? "—").join("／"), r._count.batches, <ActionDialog key="e" label="編輯" size="sm" variant="ghost" title="編輯烘豆機" payload={{ id: r.id }} fields={f(r)} action={saveRoaster} />])} />
        </Card>
      );
    }
    case "suppliers": {
      const ss = await prisma.supplier.findMany({ orderBy: { code: "asc" } });
      const f = (x?: (typeof ss)[number]): DialogField[] => [
        { name: "code", label: "代碼", required: true, defaultValue: s(x?.code) },
        { name: "name", label: "名稱", required: true, defaultValue: s(x?.name) },
        { name: "contact", label: "聯絡人", defaultValue: s(x?.contact) },
        { name: "phone", label: "電話", defaultValue: s(x?.phone) },
        { name: "email", label: "Email", defaultValue: s(x?.email) },
        { name: "country", label: "國家", defaultValue: s(x?.country) },
        { name: "note", label: "備註", type: "textarea", defaultValue: s(x?.note) },
      ];
      return (
        <Card>
          <CardHeader title="供應商" action={<ActionDialog label="＋ 新增" size="sm" title="新增供應商" fields={f()} action={saveSupplier} />} />
          <SimpleTable head={["代碼", "名稱", "聯絡人", "電話", "國家", ""]} rows={ss.map((x) => [x.code, x.name, x.contact ?? "—", x.phone ?? "—", x.country ?? "—", <ActionDialog key="e" label="編輯" size="sm" variant="ghost" title="編輯供應商" payload={{ id: x.id }} fields={f(x)} action={saveSupplier} />])} />
        </Card>
      );
    }
    case "equipment": {
      const es = await prisma.equipment.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] });
      const f = (x?: (typeof es)[number]): DialogField[] => [
        { name: "type", label: "類型", type: "select", options: Object.entries(EQUIPMENT_TYPE).map(([value, label]) => ({ value, label })), defaultValue: s(x?.type) },
        { name: "name", label: "名稱", required: true, defaultValue: s(x?.name) },
        { name: "brand", label: "品牌", defaultValue: s(x?.brand) },
        { name: "model", label: "型號", defaultValue: s(x?.model) },
        { name: "note", label: "備註", type: "textarea", defaultValue: s(x?.note) },
      ];
      return (
        <Card>
          <CardHeader title="沖煮器材" description="研磨機、濾杯、濾紙等主檔" action={<ActionDialog label="＋ 新增" size="sm" title="新增器材" fields={f()} action={saveEquipment} />} />
          <SimpleTable head={["類型", "名稱", "品牌", "型號", ""]} rows={es.map((x) => [EQUIPMENT_TYPE[x.type], x.name, x.brand ?? "—", x.model ?? "—", <ActionDialog key="e" label="編輯" size="sm" variant="ghost" title="編輯器材" payload={{ id: x.id }} fields={f(x)} action={saveEquipment} />])} />
        </Card>
      );
    }
    case "flavors": {
      const ts = await prisma.flavorTag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }], include: { _count: { select: { cuppings: true, brews: true } } } });
      return (
        <Card>
          <CardHeader title="風味詞彙" description="杯測／手沖輸入的新詞彙會自動加入" action={<ActionDialog label="＋ 新增" size="sm" title="新增風味詞彙" fields={[{ name: "name", label: "詞彙", required: true }, { name: "category", label: "分類" }]} action={saveFlavorTag} />} />
          <SimpleTable head={["詞彙", "分類", "使用次數", ""]} rows={ts.map((t) => [t.name, t.category ?? "—", t._count.cuppings + t._count.brews, <ActionDialog key="e" label="編輯" size="sm" variant="ghost" title="編輯詞彙" payload={{ id: t.id }} fields={[{ name: "name", label: "詞彙", required: true, defaultValue: t.name }, { name: "category", label: "分類", defaultValue: s(t.category) }]} action={saveFlavorTag} />])} />
        </Card>
      );
    }
    case "templates": {
      const ts = await prisma.cuppingTemplate.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { sessions: true } } } });
      return (
        <Card>
          <CardHeader
            title="杯測評分模板"
            description="自訂評分系統，明確標示非 SCA 官方標準。已使用的模板不可修改，請建立新模板。"
            action={
              <ActionDialog
                label="＋ 新增模板"
                size="sm"
                title="新增評分模板"
                fields={[
                  { name: "name", label: "名稱", required: true },
                  { name: "description", label: "說明", defaultValue: "ATA Coffee 自訂評分（非 SCA 官方）" },
                  { name: "scaleMin", label: "最低分", type: "number", defaultValue: "0" },
                  { name: "scaleMax", label: "最高分", type: "number", defaultValue: "10" },
                  { name: "step", label: "間距", type: "number", defaultValue: "0.25" },
                  { name: "attributes", label: "評分項目（每行 代碼:名稱）", type: "textarea", required: true, defaultValue: "fragrance:乾香\naroma:濕香\nacidity:酸質\nsweetness:甜感\nbody:醇厚度\nbalance:平衡\naftertaste:尾韻\noverall:整體評價" },
                  { name: "isDefault", label: "設為預設", type: "select", options: [{ value: "false", label: "否" }, { value: "true", label: "是" }] },
                ]}
                action={saveTemplate}
              />
            }
          />
          <SimpleTable head={["名稱", "分數範圍", "評分項目", "使用次數", ""]} rows={ts.map((t) => [t.name, `${t.scaleMin}–${t.scaleMax}（間距 ${t.step}）`, (t.attributes as Array<{ label: string }>).map((a) => a.label).join("、"), t._count.sessions, t.isDefault ? <Badge key="d" tone="primary">預設</Badge> : ""])} />
        </Card>
      );
    }
    case "materials": {
      const ms = await prisma.material.findMany({ orderBy: { code: "asc" }, include: { inventoryItem: { include: { lots: true } } } });
      const f = (x?: (typeof ms)[number]): DialogField[] => [
        { name: "code", label: "代碼", required: true, defaultValue: s(x?.code) },
        { name: "name", label: "名稱", required: true, defaultValue: s(x?.name) },
        { name: "category", label: "類別", type: "select", options: Object.entries(MATERIAL_CATEGORY).map(([value, label]) => ({ value, label })), defaultValue: s(x?.category) },
        { name: "spec", label: "規格", defaultValue: s(x?.spec) },
        { name: "note", label: "備註", type: "textarea", defaultValue: s(x?.note) },
      ];
      return (
        <Card>
          <CardHeader title="包材品項" description="入庫請至庫存中心 → 包材" action={<><LinkButton href="/inventory?kind=MATERIAL" size="sm" variant="ghost">包材庫存</LinkButton><ActionDialog label="＋ 新增" size="sm" title="新增包材" fields={f()} action={saveMaterial} /></>} />
          <SimpleTable head={["代碼", "名稱", "類別", "規格", "在庫", ""]} rows={ms.map((m) => [m.code, m.name, MATERIAL_CATEGORY[m.category], m.spec ?? "—", `${fmtNum(m.inventoryItem?.lots.reduce((a, l) => a + Number(l.onHand), 0) ?? 0, 0)} 件`, <ActionDialog key="e" label="編輯" size="sm" variant="ghost" title="編輯包材" payload={{ id: m.id }} fields={f(m)} action={saveMaterial} />])} />
        </Card>
      );
    }
    case "locations": {
      const ls = await prisma.inventoryLocation.findMany({ orderBy: { code: "asc" } });
      return (
        <Card>
          <CardHeader title="儲位" action={<ActionDialog label="＋ 新增" size="sm" title="新增儲位" fields={[{ name: "code", label: "代碼", required: true }, { name: "name", label: "名稱", required: true }, { name: "note", label: "備註" }]} action={saveLocation} />} />
          <SimpleTable head={["代碼", "名稱", "備註", ""]} rows={ls.map((l) => [l.code, l.name, l.note ?? "—", <ActionDialog key="e" label="編輯" size="sm" variant="ghost" title="編輯儲位" payload={{ id: l.id }} fields={[{ name: "code", label: "代碼", required: true, defaultValue: l.code }, { name: "name", label: "名稱", required: true, defaultValue: l.name }, { name: "note", label: "備註", defaultValue: s(l.note) }]} action={saveLocation} />])} />
        </Card>
      );
    }
    case "defaults": {
      const st = await getSettings();
      return (
        <EntityForm
          submitLabel="儲存預設值"
          defaultValues={{ taxMode: st.tax.mode, taxRate: st.tax.rate, requirePaymentBeforeShip: String(st.order.requirePaymentBeforeShip), lowGreenG: String(st.inventory.lowGreenG), lowRoastedG: String(st.inventory.lowRoastedG), lowFinishedPcs: String(st.inventory.lowFinishedPcs), expiryWarnDays: String(st.inventory.expiryWarnDays) }}
          sections={[
            { key: "a", title: "稅務與訂單", description: "變更只影響之後建立的訂單；歷史訂單保留當時的稅務設定快照。本系統非正式稅務申報系統。" },
            { key: "b", title: "庫存預警" },
          ]}
          fields={[
            { name: "taxMode", label: "稅務處理方式", type: "select", required: true, options: [{ value: "INCLUSIVE", label: "售價含稅（內含）" }, { value: "EXCLUSIVE", label: "售價未稅（外加）" }, { value: "NONE", label: "不計稅" }], section: "a" },
            { name: "taxRate", label: "營業稅率（小數）", type: "number", hint: "5% 請填 0.05", section: "a" },
            { name: "requirePaymentBeforeShip", label: "出貨前必須確認付款", type: "select", required: true, options: [{ value: "true", label: "是" }, { value: "false", label: "否（允許貨到付款等）" }], section: "a" },
            { name: "lowGreenG", label: "生豆預警（每品項）", type: "number", unit: "g", section: "b" },
            { name: "lowRoastedG", label: "熟豆預警（每品項）", type: "number", unit: "g", section: "b" },
            { name: "lowFinishedPcs", label: "成品預警（每 SKU）", type: "number", unit: "件", section: "b" },
            { name: "expiryWarnDays", label: "有效日期提醒（天內）", type: "number", unit: "天", section: "b" },
          ]}
          action={saveDefaults}
        />
      );
    }
    case "brand": {
      const assets = await prisma.brandAsset.findMany({ orderBy: { createdAt: "desc" } });
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
            <CardHeader title="上傳品牌素材" description="檔案類型與大小於伺服器驗證；只有勾選「正式官方素材」的檔案會被視為官方版本" />
            <CardBody>
              <BrandUpload />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="素材庫" />
            <SimpleTable
              head={["預覽", "類型", "名稱", "官方", "上傳時間"]}
              rows={assets.map((a) => [
                a.storageKey ? <img key="i" src={`/api/files/${a.storageKey}`} alt={a.name} className="h-12 w-12 rounded object-contain" /> : "—",
                { LOGO: "Logo", MASCOT_ATI: "Ati", MASCOT_ATO: "Ato", PACKAGING: "包裝", OTHER: "其他" }[a.kind],
                a.name,
                a.isOfficial ? <Badge key="o" tone="sage">官方</Badge> : <Badge key="o">非官方／暫用</Badge>,
                fmtDateTime(a.createdAt),
              ])}
              empty="尚未上傳"
            />
          </Card>
        </div>
      );
    }
    case "data": {
      const ex = [
        ["coffees", "咖啡豆主檔"],
        ["green-lots", "生豆採購批次"],
        ["roast-batches", "烘焙批次"],
        ["cupping", "杯測紀錄"],
        ["brews", "手沖紀錄"],
        ["inventory-ledger", "庫存帳本"],
        ["inventory-lots", "庫存批次餘額"],
        ["orders", "訂單"],
        ["order-items", "訂單明細"],
        ["products", "商品 SKU"],
        ["customers", "顧客（含個資，請妥善保管）"],
      ];
      return (
        <div className="grid gap-6">
          <Card>
            <CardHeader title="資料匯出（CSV，UTF-8 BOM，Excel 可直接開啟）" description="匯出動作會寫入操作紀錄" />
            <CardBody className="flex flex-wrap gap-2">
              {ex.map(([k, l]) => (
                <a key={k} href={`/api/export/${k}`} className="rounded-lg border border-border-strong px-3 py-2 text-sm hover:bg-surface-2">
                  ⬇ {l}
                </a>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="資料匯入：咖啡豆主檔（CSV）" description="欄位：code,nameZh,nameEn,country,region,farm,producer,variety,process,altitude,grade,originFlavorNotes。已存在的 code 會略過，不覆寫。庫存與交易資料不提供直接匯入，以確保帳本一致。" />
            <CardBody>
              <form action="/api/import/coffees" method="post" encType="multipart/form-data" className="flex flex-wrap items-center gap-3">
                <input type="file" name="file" accept=".csv" required className="text-sm" />
                <button className="h-10 rounded-lg bg-primary px-4 text-sm text-primary-fg">匯入</button>
              </form>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="備份與還原" />
            <CardBody className="space-y-2 text-sm leading-relaxed">
              <p>正式資料庫的備份請使用資料庫層級工具（pg_dump／Supabase 每日備份），而非 CSV 匯出。完整步驟見專案文件 <code>DEPLOYMENT.md</code>「備份與還原」。</p>
              <ul className="list-disc pl-5 text-muted">
                <li>
                  本機／自架：<code>npm run backup</code> 產生 <code>backups/ata-YYYYMMDD-HHmm.dump</code>（pg_dump 自訂格式）
                </li>
                <li>
                  還原：<code>pg_restore --clean --if-exists -d &lt;資料庫連線&gt; 備份檔</code>（請先還原到測試資料庫驗證）
                </li>
                <li>上傳檔案（曲線原始檔、品牌素材）位於 STORAGE_LOCAL_DIR，需一併備份</li>
              </ul>
            </CardBody>
          </Card>
        </div>
      );
    }
    case "api": {
      const keys = await prisma.apiKey.findMany({ orderBy: { createdAt: "desc" } });
      return (
        <div className="grid gap-6">
          <Notice>
            未來官網應由「官網後端伺服器」以 API 金鑰呼叫 <code>POST /api/storefront/v1/orders</code>（建立訂單、保留庫存）與 <code>GET /api/storefront/v1/products</code>。金鑰只能放在伺服器環境變數，不可放入瀏覽器。前台無法直接修改庫存，訂單一律經由同一套訂單 Domain Service。詳見 API 說明文件。
          </Notice>
          <Card>
            <CardHeader title="API 金鑰" action={<ActionDialog label="＋ 建立金鑰" size="sm" title="建立 API 金鑰" description="金鑰只會顯示一次，資料庫僅保存雜湊值。" fields={[{ name: "name", label: "用途名稱", required: true, defaultValue: "官網" }]} action={createApiKey} />} />
            <SimpleTable head={["名稱", "前綴", "權限", "建立", "最後使用", "狀態", ""]} rows={keys.map((k) => [k.name, <code key="p">{k.prefix}…</code>, k.scopes.join(", "), fmtDateTime(k.createdAt), fmtDateTime(k.lastUsedAt), k.revokedAt ? <Badge key="r">已撤銷</Badge> : <Badge key="r" tone="sage">有效</Badge>, k.revokedAt ? "" : <ActionDialog key="x" label="撤銷" size="sm" variant="ghost" title="撤銷此金鑰？" payload={{ id: k.id }} action={revokeApiKey} />])} empty="尚未建立" />
          </Card>
        </div>
      );
    }
    case "audit": {
      const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 1000, include: { actor: true } });
      return (
        <DataTable
          pageSize={50}
          columns={[
            { key: "time", label: "時間", sortable: true },
            { key: "actor", label: "操作者" },
            { key: "action", label: "動作" },
            { key: "entity", label: "對象", hideOnMobile: true },
            { key: "summary", label: "摘要" },
            { key: "ip", label: "IP", hideOnMobile: true },
          ]}
          filters={[{ key: "entity", label: "對象類型", options: [...new Set(logs.map((l) => l.entityType))].map((v) => ({ value: v, label: v })) }]}
          rows={logs.map((l) => ({
            id: l.id,
            search: [l.action, l.entityType, l.summary, l.actor?.name].join(" "),
            filters: { entity: l.entityType },
            sort: { time: l.createdAt.getTime() },
            cells: { time: fmtDateTime(l.createdAt), actor: l.actor?.name ?? "系統", action: <code className="text-xs">{l.action}</code>, entity: l.entityType, summary: l.summary ?? "—", ip: l.ip ?? "—" },
          }))}
        />
      );
    }
  }
  return <A href="/settings/account">返回</A>;
}
