"use client";

import { useState } from "react";
import { fmtDateTime } from "@/lib/time";
import { callOp, opAction } from "@/lib/api";
import { useCol, useDocument, type Row } from "@/lib/data";
import { EntityForm } from "@/components/entity-form";
import { toast } from "@/components/toast";
import { Badge, Button, Card, CardBody, CardHeader, Notice, SimpleTable } from "@/components/ui";

const EVENTS = [
  ["newOrder", "新訂單"],
  ["payment", "顧客回報匯款"],
  ["lowStock", "庫存低於門檻"],
  ["packaging", "接單後分裝待處理"],
] as const;
const EVENT_LABEL: Record<string, string> = { ...Object.fromEntries(EVENTS), daily: "每日彙整", test: "測試" };

const input = "mt-1 h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm text-fg";

/** 系統設定 → 通知：Telegram 機器人、Gmail 寄信、通知項目 */
export function NotifySettings() {
  const st = useDocument("settings", "notify");
  const logs = useCol("notifyLog", [], "at");
  if (st.loading) return <p className="text-sm text-muted">載入中…</p>;
  const s: Row = st.data ?? { id: "notify" };
  return (
    <div className="grid gap-6">
      <Notice>每天 08:30（臺北時間）自動送出每日彙整；勾選的事件發生時即時通知。金鑰與密碼只會存在伺服器，連管理員也無法從網頁讀回。</Notice>
      <Telegram s={s} />
      <Gmail s={s} />
      <Card>
        <CardHeader title="通知項目" />
        <CardBody>
          <EntityForm
            key={JSON.stringify([s.gmailUser, s.emailTo, s.tgEvents, s.emailEvents, s.dailyTelegram, s.dailyEmail])}
            submitLabel="儲存通知設定"
            defaultValues={{
              gmailUser: s.gmailUser ?? "",
              emailTo: ((s.emailTo as string[]) ?? []).join(", "),
              dailyTelegram: s.dailyTelegram ?? true,
              dailyEmail: s.dailyEmail ?? true,
              ...Object.fromEntries(EVENTS.flatMap(([k]) => [[`tg_${k}`, s.tgEvents?.[k] ?? true], [`em_${k}`, s.emailEvents?.[k] ?? false]])),
            }}
            sections={[
              { key: "a", title: "Email 收寄", description: "寄件帳號需搭配下方「Gmail 應用程式密碼」" },
              { key: "b", title: "每日彙整（每天 08:30）" },
              { key: "c", title: "即時通知：Telegram" },
              { key: "d", title: "即時通知：Email" },
            ]}
            fields={[
              { name: "gmailUser", label: "寄件 Gmail 帳號", type: "email", placeholder: "例：atacoffee.notify@gmail.com", section: "a" },
              { name: "emailTo", label: "收件 Email（多個以逗號分隔）", section: "a", wide: true },
              { name: "dailyTelegram", label: "傳送到 Telegram", type: "checkbox", section: "b" },
              { name: "dailyEmail", label: "寄送 Email", type: "checkbox", section: "b" },
              ...EVENTS.map(([k, label]) => ({ name: `tg_${k}`, label, type: "checkbox" as const, section: "c" })),
              ...EVENTS.map(([k, label]) => ({ name: `em_${k}`, label, type: "checkbox" as const, section: "d" })),
            ]}
            action={opAction("notify.save")}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="測試與紀錄"
          action={
            <span className="flex gap-2">
              <RunButton op="notify.test" label="傳送測試通知" />
              <RunButton op="notify.dailyNow" label="立即送出今日彙整" />
            </span>
          }
        />
        <SimpleTable
          head={["時間", "項目", "管道", "結果", "標題"]}
          rows={logs.data.slice(0, 30).map((l) => [fmtDateTime(l.at), EVENT_LABEL[l.event] ?? l.event, l.channel === "telegram" ? "Telegram" : "Email", l.ok ? <Badge key="o" tone="sage">成功</Badge> : <span key="e" className="text-danger" title={l.error}>失敗：{String(l.error ?? "").slice(0, 60)}</span>, l.title])}
          empty="尚無通知紀錄"
        />
      </Card>
    </div>
  );
}

function RunButton({ op, label, input: payload, variant = "outline", onDone }: { op: string; label: string; input?: Record<string, unknown>; variant?: "outline" | "primary" | "ghost"; onDone?: (d: Record<string, unknown>) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await callOp(op, payload ?? {});
        setBusy(false);
        if (!r.ok) return toast(r.error, "error");
        if (r.message) toast(r.message);
        onDone?.((r.data ?? {}) as Record<string, unknown>);
      }}
    >
      {busy ? "處理中…" : label}
    </Button>
  );
}

function SecretForm({ name, label, placeholder, hint, onSaved }: { name: "telegramBotToken" | "gmailAppPassword"; label: string; placeholder: string; hint: React.ReactNode; onSaved?: () => void }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await callOp("notify.setSecrets", { [name]: v.trim() });
        setBusy(false);
        if (!r.ok) return toast(r.error, "error");
        setV("");
        toast(r.message ?? "已更新");
        onSaved?.();
      }}
    >
      <label className="text-xs text-muted">
        {label}
        <input type="password" autoComplete="off" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} required className={input} />
      </label>
      <p className="text-xs text-muted">{hint}</p>
      <Button type="submit" size="sm" disabled={busy || !v.trim()} className="w-fit">
        {busy ? "驗證中…" : "驗證並儲存"}
      </Button>
    </form>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Telegram({ s }: { s: Record<string, any> }) {
  const [link, setLink] = useState<{ code: string; bot: string; link: string } | null>(null);
  return (
    <Card>
      <CardHeader
        title="Telegram"
        description={s.telegramBot ? `機器人 @${s.telegramBot}` : "尚未設定機器人"}
        action={s.telegramChatId ? <Badge tone="sage">已連結：{s.telegramChatTitle ?? s.telegramChatId}</Badge> : <Badge>未連結聊天室</Badge>}
      />
      <CardBody className="grid gap-5 text-sm">
        <ol className="list-decimal space-y-1 pl-5 text-muted">
          <li>在 Telegram 搜尋 @BotFather，傳送 /newbot，依指示取名，取得機器人金鑰（類似 123456789:AAH…）。</li>
          <li>把金鑰貼到下方「驗證並儲存」（只有你自己在這裡輸入，請勿貼到聊天或其他地方）。</li>
          <li>按「開始連結」，再到 Telegram 對機器人傳送畫面上的 /start 驗證碼，然後按「完成連結」。想傳到群組：先把機器人加入群組，在群組傳送驗證碼。</li>
        </ol>
        <SecretForm name="telegramBotToken" label={s.hasTelegramToken ? "更換機器人金鑰" : "機器人金鑰"} placeholder={s.hasTelegramToken ? "已設定（輸入新金鑰可更換）" : "123456789:AAH…"} hint="儲存前會先向 Telegram 驗證金鑰是否有效。" />
        {s.hasTelegramToken && (
          <div className="grid gap-3 border-t border-border pt-4">
            <div className="flex flex-wrap gap-2">
              <RunButton op="notify.linkStart" label={s.telegramChatId ? "重新連結聊天室" : "開始連結"} variant="primary" onDone={(d) => setLink(d as typeof link)} />
              {link && <RunButton op="notify.linkDetect" label="完成連結" onDone={() => setLink(null)} />}
              {s.telegramChatId && <RunButton op="notify.unlinkTelegram" label="解除聊天室" variant="ghost" />}
              <RunButton op="notify.setSecrets" input={{ clearTelegram: true }} label="移除機器人金鑰" variant="ghost" />
            </div>
            {link && (
              <Notice>
                請在 Telegram 對 @{link.bot} 傳送：<b className="mx-1 font-mono">/start {link.code}</b>（
                <a href={link.link} target="_blank" rel="noreferrer" className="underline">
                  點這裡直接開啟
                </a>
                ），送出後回到這裡按「完成連結」。驗證碼 30 分鐘內有效。
              </Notice>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Gmail({ s }: { s: Record<string, any> }) {
  return (
    <Card>
      <CardHeader title="Gmail 寄信" description={s.gmailUser ? `寄件帳號 ${s.gmailUser}` : "尚未設定寄件帳號"} action={s.hasGmailPassword ? <Badge tone="sage">已設定密碼</Badge> : <Badge>未設定密碼</Badge>} />
      <CardBody className="grid gap-4 text-sm">
        <ol className="list-decimal space-y-1 pl-5 text-muted">
          <li>建議另外申請一個專門寄通知的 Gmail，並開啟「兩步驟驗證」。</li>
          <li>
            到 Google 帳號 →「安全性」→「應用程式密碼」，產生一組 16 碼密碼（
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="underline">
              開啟設定頁
            </a>
            ）。
          </li>
          <li>先在下方「通知項目」填寫寄件 Gmail 帳號並儲存，再把 16 碼密碼貼到這裡。</li>
        </ol>
        {s.gmailUser ? (
          <SecretForm name="gmailAppPassword" label={s.hasGmailPassword ? "更換應用程式密碼" : "應用程式密碼（16 碼）"} placeholder={s.hasGmailPassword ? "已設定（輸入新密碼可更換）" : "xxxx xxxx xxxx xxxx"} hint="儲存前會先連線 Gmail 驗證；這不是你的 Gmail 登入密碼。" />
        ) : (
          <p className="text-muted">請先在下方填寫寄件 Gmail 帳號並儲存。</p>
        )}
        {s.hasGmailPassword && (
          <div>
            <RunButton op="notify.setSecrets" input={{ clearGmail: true }} label="移除應用程式密碼" variant="ghost" />
          </div>
        )}
      </CardBody>
    </Card>
  );
}
