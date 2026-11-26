"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Boxes, Coffee, Flame, FlaskConical, Info, Package, ShoppingBasket, type LucideIcon } from "lucide-react";
import { D, fmtGrams, fmtMoney2, fmtNum, fmtPct } from "@/lib/decimal";
import { fmtDate, fmtDbDate } from "@/lib/time";
import { opAction } from "@/lib/api";
import { useCol, useDocument } from "@/lib/data";
import { LOT_STATUS, PROD_STATUS } from "@/lib/labels";
import { Guard, useQS, withNext } from "@/lib/page";
import { ActionDialog } from "@/components/action-dialog";
import { DeleteButton } from "@/components/delete-button";
import { StatusBadge } from "@/components/status";
import { A, Badge, Card, CardBody, CardHeader, KV, LinkButton, PageHeader, SimpleTable, cn } from "@/components/ui";

type StepKey = "info" | "green" | "roast" | "cup" | "brew" | "pack" | "stock";
const STEPS: Array<{ key: StepKey; no?: number; label: string; icon: LucideIcon }> = [
  { key: "info", label: "基本資料", icon: Info },
  { key: "green", no: 1, label: "生豆採購", icon: ShoppingBasket },
  { key: "roast", no: 2, label: "烘豆", icon: Flame },
  { key: "cup", no: 3, label: "杯測", icon: FlaskConical },
  { key: "brew", no: 4, label: "手沖", icon: Coffee },
  { key: "pack", no: 5, label: "分裝", icon: Package },
  { key: "stock", no: 6, label: "庫存", icon: Boxes },
];
const KIND: Record<string, string> = { GREEN: "生豆", ROASTED: "熟豆", FINISHED: "成品", MATERIAL: "包材" };

/** 行內的小操作連結 */
function Act({ href, children, tone }: { href: string; children: ReactNode; tone?: "primary" }) {
  return (
    <Link href={href} className={cn("rounded-md px-2 py-1 text-xs whitespace-nowrap hover:bg-surface-2", tone === "primary" ? "font-medium text-primary" : "text-fg/80")}>
      {children}
    </Link>
  );
}
const Acts = ({ children }: { children: ReactNode }) => <span className="flex flex-wrap items-center justify-end gap-0.5">{children}</span>;

/**
 * 咖啡豆頁（主角）：同一支豆子的生豆採購 → 烘豆 → 杯測 → 手沖 → 分裝 → 庫存都在這裡。
 * 每個步驟都可以直接新增（從任意步驟開始；缺前一步時表單會帶你先補上再回來）、修改、刪除，完成後回到這頁。
 */
export default function CoffeeHub() {
  const id = useQS("id");
  const step = (useQS("step") as StepKey | null) ?? null;
  const c = useDocument("coffees", id);
  const greens = useCol("greenLots", [["coffeeId", id]], "receivedAt");
  const lots = useCol("invLots", [["coffeeId", id]]);
  const roasts = useCol("roastBatches", [["coffeeId", id]], "roastedAt");
  const cups = useCol("cuppingSessions", [["coffeeId", id]], "cuppedAt");
  const brews = useCol("brewSessions", [["coffeeId", id]], "brewedAt");
  const pos = useCol("productionOrders", [], "createdAt");
  const variants = useCol("variants", [["coffeeId", id]], "sku", false);

  const here = `/coffees/view/?id=${id}${step ? `&step=${step}` : ""}`;
  const go = (href: string) => withNext(href, here);
  const lot = (lotId: unknown) => lots.data.find((l) => l.id === lotId);
  const roastLotIds = new Set(roasts.data.map((r) => r.invLotId));
  const myPos = pos.data.filter((p) => roastLotIds.has(p.sourceLotId));
  const stock = (kind: string) => lots.data.filter((l) => l.kind === kind && l.status === "AVAILABLE").reduce((s, l) => s.add(l.onHand), D(0));
  const scored = cups.data.filter((x) => x.totalScore != null);
  const avgScore = scored.length ? scored.reduce((s, x) => s.add(x.totalScore), D(0)).div(scored.length) : null;
  const liveLots = lots.data.filter((l) => !D(l.onHand).isZero() || D(l.reserved).gt(0));

  return (
    <Guard loading={c.loading} error={c.error} missing={!c.data}>
      {() => {
        const x = c.data!;
        const counts: Record<StepKey, ReactNode> = {
          info: x.process ?? "",
          green: `${greens.data.length} 批・${fmtGrams(stock("GREEN"))}`,
          roast: `${roasts.data.length} 批`,
          cup: `${cups.data.length} 次${avgScore ? `・平均 ${avgScore.toFixed(2)}` : ""}`,
          brew: `${brews.data.length} 次`,
          pack: `${myPos.length} 張`,
          stock: `熟豆 ${fmtGrams(stock("ROASTED"))}`,
        };
        const sections: Record<Exclude<StepKey, "info">, { title: string; add: ReactNode; head: ReactNode[]; rows: ReactNode[][]; empty: ReactNode }> = {
          green: {
            title: "生豆採購",
            add: <LinkButton size="sm" href={go(`/green/new/?coffee=${x.id}`)}>＋ 生豆採購</LinkButton>,
            head: ["批次", "採購日", "供應商", "入庫量", "剩餘", "每克成本", ""],
            rows: [...greens.data].reverse().map((g) => [
              <A key="l" href={`/inventory/lot/?id=${g.invLotId}`}>{g.lotCode}</A>,
              fmtDbDate(g.purchaseDate),
              g.supplierName ?? "—",
              fmtGrams(g.receivedWeightG),
              fmtGrams(lot(g.invLotId)?.onHand),
              fmtMoney2(g.costPerG),
              <Acts key="a">
                <Act tone="primary" href={go(`/roasting/new/?coffee=${x.id}&green=${g.id}`)}>烘豆</Act>
                <Act href={go(`/green/new/?edit=${g.id}`)}>修改</Act>
                <DeleteButton what="生豆採購" name={g.lotCode} id={g.id} op="green.delete" description="這批生豆的庫存會一起移除。有其他紀錄用到時，會先提醒你確認。" />
              </Acts>,
            ]),
            empty: "還沒有生豆採購。也可以不記採購，直接從杯測或手沖開始（樣品、外購熟豆）。",
          },
          roast: {
            title: "烘豆",
            add: (
              <>
                <LinkButton size="sm" variant="outline" href="/roasting/live/">平板即時紀錄</LinkButton>
                <LinkButton size="sm" href={go(`/roasting/new/?coffee=${x.id}`)}>＋ 烘豆</LinkButton>
              </>
            ),
            head: ["批次", "日期", "投入 → 產出", "失重率", "DTR", "熟豆剩餘", ""],
            rows: [...roasts.data].reverse().map((r) => [
              <A key="r" href={`/roasting/view/?id=${r.id}`}>{r.batchNo}</A>,
              fmtDate(r.roastedAt),
              `${fmtGrams(r.greenWeightG)} → ${fmtGrams(r.roastedWeightG)}`,
              fmtPct(r.weightLossPercent),
              fmtPct(r.dtrPercent),
              fmtGrams(lot(r.invLotId)?.onHand),
              <Acts key="a">
                <Act tone="primary" href={go(`/cupping/new/?coffee=${x.id}&roast=${r.id}`)}>杯測</Act>
                <Act tone="primary" href={go(`/brewing/new/?coffee=${x.id}&roast=${r.id}`)}>手沖</Act>
                <Act tone="primary" href={go(`/production/new/?coffee=${x.id}&lot=${r.invLotId}`)}>分裝</Act>
                <Act href={go(`/roasting/new/?edit=${r.id}`)}>修改</Act>
                <DeleteButton what="烘焙紀錄" name={r.batchNo} id={r.id} op="roast.delete" description="投入的生豆會退回庫存，曲線與成本一起刪除。有其他紀錄用到時，會先提醒你確認。" />
              </Acts>,
            ]),
            empty: "還沒有烘豆紀錄。",
          },
          cup: {
            title: "杯測",
            add: <LinkButton size="sm" href={go(`/cupping/new/?coffee=${x.id}`)}>＋ 杯測</LinkButton>,
            head: ["日期", "豆子來源", "烘後", "平均分", "風味", ""],
            rows: [...cups.data].reverse().map((q) => [
              <A key="d" href={`/cupping/view/?id=${q.id}`}>{fmtDate(q.cuppedAt)}</A>,
              q.roastBatchId ? q.batchNo : q.roastDeleted ? <span key="s" title="烘焙紀錄已刪除">{q.batchNo} <Badge>已刪除</Badge></span> : <Badge key="s">樣品</Badge>,
              q.restDays == null ? "—" : `${q.restDays} 天`,
              fmtNum(q.totalScore, 2),
              <span key="t" className="line-clamp-1 max-w-56">{((q.tags as string[]) ?? []).join("、") || "—"}</span>,
              <Acts key="a">
                <Act href={go(`/cupping/new/?edit=${q.id}`)}>修改</Act>
                <DeleteButton what="杯測紀錄" name={fmtDate(q.cuppedAt)} id={q.id} op="cupping.delete" description="若曾扣熟豆庫存，會自動退回。" />
              </Acts>,
            ]),
            empty: "還沒有杯測。沒有烘豆紀錄也能記（選「沒有烘豆紀錄」）。",
          },
          brew: {
            title: "手沖",
            add: <LinkButton size="sm" href={go(`/brewing/new/?coffee=${x.id}`)}>＋ 手沖</LinkButton>,
            head: ["日期", "豆子來源", "烘後", "粉量・粉水比", "評分", "風味", ""],
            rows: [...brews.data].reverse().map((b) => [
              <A key="d" href={`/brewing/view/?id=${b.id}`}>{fmtDate(b.brewedAt)}</A>,
              b.roastBatchId ? b.batchNo : b.roastDeleted ? <span key="s" title="烘焙紀錄已刪除">{b.batchNo} <Badge>已刪除</Badge></span> : <Badge key="s">樣品</Badge>,
              b.restDays == null ? "—" : `${b.restDays} 天`,
              `${fmtNum(b.doseG, 1)}g・1:${fmtNum(b.ratio, 1)}`,
              fmtNum(b.rating, 1),
              <span key="f" className="line-clamp-1 max-w-56">{b.flavorNotes || ((b.tags as string[]) ?? []).join("、") || "—"}</span>,
              <Acts key="a">
                <Act href={go(`/brewing/new/?copy=${b.id}${b.roastBatchId ? "" : "&sample=1"}`)}>複製</Act>
                <Act href={go(`/brewing/new/?edit=${b.id}`)}>修改</Act>
                <DeleteButton what="手沖紀錄" name={fmtDate(b.brewedAt)} id={b.id} op="brew.delete" description="若曾扣熟豆庫存，會自動退回。" />
              </Acts>,
            ]),
            empty: "還沒有手沖紀錄。沒有烘豆紀錄也能記（選「沒有烘豆紀錄」）。",
          },
          pack: {
            title: "分裝",
            add: <LinkButton size="sm" href={go(`/production/new/?coffee=${x.id}`)}>＋ 分裝</LinkButton>,
            head: ["分裝單", "日期", "商品規格", "數量", "狀態", ""],
            rows: [...myPos]
              .sort((a, b) => String(b.plannedDate).localeCompare(String(a.plannedDate)))
              .map((p) => [
                <A key="p" href={`/production/view/?id=${p.id}`}>{p.orderNo}</A>,
                fmtDbDate(p.plannedDate),
                p.variantName,
                `${fmtNum(p.actualQty ?? p.plannedQty, 0)} 件`,
                <StatusBadge key="s" map={PROD_STATUS} value={p.status} />,
                <Acts key="a">
                  <Act href={`/production/view/?id=${p.id}`}>查看／修改</Act>
                </Acts>,
              ]),
            empty: "還沒有分裝。先有熟豆才能分裝，沒有的話表單會帶你先烘一批。",
          },
          stock: {
            title: "庫存",
            add: <LinkButton size="sm" variant="outline" href="/inventory/">庫存中心</LinkButton>,
            head: ["種類", "批次", "在庫", "已保留", "到期", "狀態", ""],
            rows: liveLots.map((l) => [
              KIND[l.kind] ?? l.kind,
              <A key="l" href={`/inventory/lot/?id=${l.id}`}>{l.lotCode}</A>,
              <span key="q" className={D(l.onHand).isNegative() ? "font-medium text-danger" : undefined} title={D(l.onHand).isNegative() ? "庫存為負，請補登入庫或盤點修正" : undefined}>{l.unit === "G" ? fmtGrams(l.onHand) : `${fmtNum(l.onHand, 0)} 件`}{D(l.onHand).isNegative() ? " ⚠" : ""}</span>,
              l.unit === "G" ? fmtGrams(l.reserved) : `${fmtNum(l.reserved, 0)} 件`,
              fmtDbDate(l.expiryDate),
              <StatusBadge key="s" map={LOT_STATUS} value={l.status} />,
              <Acts key="a">
                <Act href={`/inventory/lot/?id=${l.id}`}>異動／盤點</Act>
              </Acts>,
            ]),
            empty: "目前沒有庫存。",
          },
        };
        const section = (k: Exclude<StepKey, "info">, limit?: number) => {
          const sec = sections[k];
          const more = limit && sec.rows.length > limit ? sec.rows.length - limit : 0;
          const meta = STEPS.find((s) => s.key === k)!;
          return (
            <Card key={k}>
              <CardHeader
                title={`${meta.no}. ${sec.title}`}
                action={<span className="flex flex-wrap gap-2">{sec.add}</span>}
              />
              <SimpleTable head={sec.head} rows={limit ? sec.rows.slice(0, limit) : sec.rows} empty={sec.empty as string} />
              {more > 0 && (
                <p className="border-t border-border px-5 py-2 text-sm">
                  <A href={`/coffees/view/?id=${x.id}&step=${k}`}>看全部 {sec.rows.length} 筆</A>
                </p>
              )}
            </Card>
          );
        };
        return (
          <>
            <PageHeader
              title={x.nameZh}
              description={[x.nameEn, x.code, [x.country, x.region].filter(Boolean).join("・"), x.process].filter(Boolean).join("｜")}
              back={{ href: "/coffees/", label: "咖啡豆" }}
              actions={
                <>
                  <LinkButton href={withNext(`/coffees/edit/?id=${x.id}`, here)} variant="outline">
                    編輯資料
                  </LinkButton>
                  <ActionDialog label={x.archivedAt ? "取消封存" : "封存"} variant="ghost" title={x.archivedAt ? "取消封存？" : "封存此咖啡豆？"} description="封存後不會出現在新增表單選項中，歷史資料保留。" payload={{ id: x.id }} action={opAction("coffee.archive")} />
                  <DeleteButton inline={false} what="咖啡豆" name={x.nameZh} col="coffees" id={x.id} redirectTo="/coffees/" description="只有還沒有任何採購、烘焙、杯測、手沖或商品的咖啡豆可以刪除；已使用的請改用「封存」。" />
                </>
              }
            />

            {/* 流程：點步驟只看該步驟；再點一次回到全部 */}
            <nav aria-label="咖啡豆流程" className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {STEPS.map((s) => {
                const on = step === s.key;
                const Icon = s.icon;
                return (
                  <Link
                    key={s.key}
                    href={on ? `/coffees/view/?id=${x.id}` : `/coffees/view/?id=${x.id}&step=${s.key}`}
                    aria-current={on ? "page" : undefined}
                    replace
                    scroll={false}
                    className={cn("flex items-center gap-2.5 rounded-xl border p-3 transition-colors", on ? "border-primary bg-primary-soft" : "border-border bg-surface hover:border-primary/50")}
                  >
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", on ? "bg-primary text-primary-fg" : "bg-primary-soft text-primary")}>
                      <Icon size={20} strokeWidth={1.75} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {s.no && <span className="mr-1 text-muted">{s.no}</span>}
                        {s.label}
                      </span>
                      <span className="block truncate text-xs text-muted">{counts[s.key] || " "}</span>
                    </span>
                  </Link>
                );
              })}
            </nav>

            <div className="grid gap-6">
              {(step === "info" || !step) && (
                <Card>
                  <CardHeader title="基本資料" action={<A href={withNext(`/coffees/edit/?id=${x.id}`, here)}>編輯</A>} />
                  <CardBody>
                    <KV
                      cols={4}
                      items={[
                        ["產國", x.country],
                        ["產區", x.region],
                        ["莊園", x.farm],
                        ["品種", x.variety],
                        ["處理法", x.process],
                        ["海拔", x.altitude],
                        ["供應商", x.supplierName],
                        ["原始風味", x.originFlavorNotes],
                        ...(step === "info"
                          ? ([
                              ["生產者", x.producer],
                              ["生豆等級", x.grade],
                              ["品牌商品名稱", x.brandName],
                              ["建議養豆開始", x.restStartDays != null ? `烘後 ${x.restStartDays} 天` : "未設定"],
                              ["最佳風味區間", x.peakFromDays != null ? `烘後 ${x.peakFromDays}–${x.peakToDays ?? "?"} 天` : "未設定"],
                              ["預設保存期限", x.shelfLifeDays != null ? `${x.shelfLifeDays} 天` : "未設定"],
                              ["備註", x.note],
                            ] as Array<[string, ReactNode]>)
                          : []),
                      ]}
                    />
                  </CardBody>
                </Card>
              )}
              {step === "info" && (
                <Card>
                  <CardHeader title="對應商品" />
                  <SimpleTable head={["商品", "品項編號", "售價", "填充重量"]} rows={variants.data.map((v) => [<A key="p" href={`/products/view/?id=${v.productId}`}>{v.productName}</A>, v.sku, fmtMoney2(v.salePrice), v.fillWeightG ? `${fmtNum(v.fillWeightG, 1)} g` : "—"])} empty="尚無對應商品" />
                </Card>
              )}
              {step && step !== "info" ? section(step) : !step && (["green", "roast", "cup", "brew", "pack", "stock"] as const).map((k) => section(k, 5))}
            </div>
          </>
        );
      }}
    </Guard>
  );
}

