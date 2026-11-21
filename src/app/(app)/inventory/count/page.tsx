"use client";

import { useEffect, useMemo, useState } from "react";
import { D, fmtMoney2, fmtNum } from "@/lib/decimal";
import { fmtDateTime, fmtDbDate } from "@/lib/time";
import { callOp } from "@/lib/api";
import { useCol, useDocument, type Row } from "@/lib/data";
import { Guard, useQS } from "@/lib/page";
import { toast } from "@/components/toast";
import { Badge, Button, Card, CardBody, CardHeader, KV, LinkButton, Notice, PageHeader, SimpleTable, Tabs } from "@/components/ui";

const KINDS = ["GREEN", "ROASTED", "FINISHED", "MATERIAL"] as const;
const LABEL: Record<string, string> = { GREEN: "生豆", ROASTED: "熟豆", FINISHED: "成品", MATERIAL: "包材" };
const MAX = 120;
const q = (v: unknown, unit: string) => (unit === "G" ? `${fmtNum(v as string, 1)} g` : `${fmtNum(v as string, 0)} 件`);

/** 整批盤點：輸入實盤數量 → 一次送出，差異自動記入帳本（盤點調整） */
export default function StockCountPage() {
  const id = useQS("id");
  return id ? <CountDetail id={id} /> : <CountForm />;
}

function CountForm() {
  const k = useQS("kind");
  const kind = (KINDS as readonly string[]).includes(k ?? "") ? (k as string) : "ROASTED";
  const lots = useCol("invLots", [["kind", kind]], "lotCode", false);
  const history = useCol("stockCounts", [], "createdAt");
  const [frozen, setFrozen] = useState<Map<string, string> | null>(null);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [countId, setCountId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 換類別時重新開始；第一次載入時凍結「帳面數量」，作為盤點基準
  useEffect(() => {
    setFrozen(null);
    setCounted({});
    setError(null);
  }, [kind]);
  useEffect(() => {
    if (!frozen && !lots.loading) setFrozen(new Map(lots.data.map((l) => [l.id, l.onHand as string])));
  }, [frozen, lots.loading, lots.data]);

  const rows = useMemo(() => lots.data.filter((l) => D(l.onHand).gt(0) || D(l.reserved).gt(0) || counted[l.id] !== undefined), [lots.data, counted]);
  const entered = rows.filter((l) => (counted[l.id] ?? "").trim() !== "");
  const changedLive = rows.filter((l) => frozen?.has(l.id) && !D(frozen.get(l.id)!).eq(l.onHand));
  const invalid = entered.filter((l) => !/^\d+(\.\d+)?$/.test(counted[l.id].trim()) || (l.unit === "PCS" && !/^\d+$/.test(counted[l.id].trim())));
  const diffs = entered.filter((l) => !invalid.includes(l)).map((l) => ({ l, diff: D(counted[l.id].trim()).sub(frozen?.get(l.id) ?? l.onHand) }));
  const valueDiff = diffs.reduce((s, x) => s.add(x.diff.mul(x.l.unitCost)), D(0));

  const submit = async () => {
    setError(null);
    if (!entered.length) return setError("請至少輸入一個批次的實盤數量");
    if (invalid.length) return setError(`以下批次的數量格式不正確：${invalid.map((l) => l.lotCode).join("、")}`);
    if (entered.length > MAX) return setError(`一次最多盤點 ${MAX} 個批次，請分批送出`);
    if (!confirm(`確定送出盤點？共 ${entered.length} 批，其中 ${diffs.filter((x) => !x.diff.isZero()).length} 批有差異，金額差 ${fmtMoney2(valueDiff)}。`)) return;
    setBusy(true);
    const r = await callOp("inventory.count", { countId, note, lines: entered.map((l) => ({ lotId: l.id, expected: frozen?.get(l.id) ?? l.onHand, counted: counted[l.id].trim() })) });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    toast(r.message ?? "盤點完成");
    setCountId(crypto.randomUUID());
    setCounted({});
    setNote("");
    setFrozen(null);
  };

  return (
    <>
      <PageHeader title="整批盤點" description="輸入實際盤點數量，送出後系統以「實盤 − 帳面」自動記錄盤點調整；原始帳本不修改。空白的批次不盤點。" back={{ href: `/inventory/?kind=${kind}`, label: "庫存中心" }} />
      <Tabs active={kind} tabs={KINDS.map((x) => ({ key: x, label: LABEL[x], href: `/inventory/count/?kind=${x}` }))} />
      <Guard loading={lots.loading || !frozen} error={lots.error}>
        {() => (
          <div className="grid gap-6">
            {changedLive.length > 0 && (
              <Notice tone="warning">
                盤點期間這些批次有異動（出貨、分裝等）：{changedLive.map((l) => l.lotCode).join("、")}。帳面數量已和開始盤點時不同，請
                <button type="button" className="mx-1 underline" onClick={() => setFrozen(null)}>
                  重新載入帳面數量
                </button>
                後再確認實盤。
              </Notice>
            )}
            <Card>
              <CardHeader
                title={`${LABEL[kind]}批次（${rows.length}）`}
                description="帳面數量以開始盤點時為準"
                action={
                  <Button size="sm" variant="ghost" onClick={() => setCounted(Object.fromEntries(rows.map((l) => [l.id, D(frozen?.get(l.id) ?? l.onHand).toString()])))}>
                    全部帶入帳面數量
                  </Button>
                }
              />
              <SimpleTable
                head={["批號", "品項", "儲存狀態", "已保留", "帳面", "實盤", "差異"]}
                rows={rows.map((l) => {
                  const v = counted[l.id] ?? "";
                  const book = frozen?.get(l.id) ?? l.onHand;
                  const d = v.trim() !== "" && /^\d+(\.\d+)?$/.test(v.trim()) ? D(v.trim()).sub(book) : null;
                  return [
                    <span key="c" className="font-mono text-xs">{l.lotCode}</span>,
                    l.itemName,
                    l.status === "AVAILABLE" ? "可用" : l.status === "QUARANTINE" ? <Badge key="s" tone="warning">待檢</Badge> : <Badge key="s">{l.status}</Badge>,
                    D(l.reserved).gt(0) ? q(l.reserved, l.unit) : "—",
                    q(book, l.unit),
                    <input
                      key="i"
                      aria-label={`${l.lotCode} 實盤數量`}
                      inputMode="decimal"
                      value={v}
                      onChange={(e) => setCounted((c) => ({ ...c, [l.id]: e.target.value }))}
                      className="h-9 w-28 rounded-lg border border-border bg-bg px-2 text-right text-sm"
                      placeholder={l.unit === "G" ? "g" : "件"}
                    />,
                    d == null ? "—" : d.isZero() ? <span key="d" className="text-muted">無差異</span> : <b key="d" className={d.isNegative() ? "text-danger" : "text-sage"}>{d.isNegative() ? "" : "+"}{q(d.toString(), l.unit)}</b>,
                  ];
                })}
                empty="此類別沒有在庫批次"
              />
              <CardBody className="grid gap-3 border-t border-border">
                <label className="text-xs text-muted">
                  盤點備註（例：11 月月底盤點）
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="mt-1 h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm text-fg" />
                </label>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span>
                    已輸入 {entered.length} 批・有差異 {diffs.filter((x) => !x.diff.isZero()).length} 批・金額差 <b>{fmtMoney2(valueDiff)}</b>
                  </span>
                  <Button className="ml-auto" disabled={busy} onClick={submit}>
                    {busy ? "處理中…" : "送出盤點"}
                  </Button>
                </div>
                {error && (
                  <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                    {error}
                  </p>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="盤點紀錄" />
              <SimpleTable
                head={["單號", "時間", "批次數", "有差異", "金額差", "備註", ""]}
                rows={history.data.slice(0, 30).map((h) => [h.code, fmtDateTime(h.createdAt), h.lineCount, h.changedCount, fmtMoney2(h.valueDiff), h.note ?? "—", <LinkButton key="v" size="sm" variant="ghost" href={`/inventory/count/?id=${h.id}`}>明細</LinkButton>])}
                empty="尚無盤點紀錄"
              />
            </Card>
          </div>
        )}
      </Guard>
    </>
  );
}

function CountDetail({ id }: { id: string }) {
  const c = useDocument("stockCounts", id);
  return (
    <Guard loading={c.loading} error={c.error} missing={!c.data}>
      {() => {
        const x = c.data!;
        const lines = (x.lines as Row[]) ?? [];
        return (
          <>
            <PageHeader title={`盤點 ${x.code}`} description={`${fmtDateTime(x.createdAt)}・${x.actorName ?? ""}`} back={{ href: "/inventory/count/", label: "整批盤點" }} />
            <div className="grid gap-6">
              <Card>
                <CardBody>
                  <KV cols={4} items={[["批次數", x.lineCount], ["有差異", x.changedCount], ["金額差", fmtMoney2(x.valueDiff)], ["備註", x.note]]} />
                </CardBody>
              </Card>
              <Card>
                <SimpleTable
                  head={["批號", "品項", "帳面", "實盤", "差異", "金額差", "入帳"]}
                  rows={lines.map((l) => [<span key="c" className="font-mono text-xs">{l.lotCode}</span>, l.itemName, q(l.expected, l.unit), q(l.counted, l.unit), D(l.diff).isZero() ? "—" : q(l.diff, l.unit), fmtMoney2(l.valueDiff), l.txId ? <LinkButton key="t" size="sm" variant="ghost" href={`/inventory/lot/?id=${l.lotId}`}>批次帳本</LinkButton> : "無需調整"])}
                />
              </Card>
              <p className="text-xs text-muted">盤點日期 {fmtDbDate(x.createdAt)}；差異以盤點調整（ADJUSTMENT）記入庫存帳本，可於批次帳本查詢。</p>
            </div>
          </>
        );
      }}
    </Guard>
  );
}
