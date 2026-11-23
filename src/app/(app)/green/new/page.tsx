"use client";

import { nowTaipeiLocal, toTaipeiLocalInput, todayTaipei } from "@/lib/time";
import { opAction } from "@/lib/api";
import { useCol, useDocument } from "@/lib/data";
import { useCoffeeOptions, useNext, useQS, withNext } from "@/lib/page";
import { EntityForm } from "@/components/entity-form";
import { LinkButton, Notice, PageHeader } from "@/components/ui";

/** 新增生豆採購；?edit=<生豆批次 id> 為修改 */
export default function NewGreenPage() {
  const coffee = useQS("coffee");
  const editId = useQS("edit");
  const cur = useDocument("greenLots", editId);
  const g = editId ? cur.data : null;
  const next = useNext();
  const coffees = useCoffeeOptions();
  const suppliers = useCol("suppliers", [], "code", false);
  const locations = useCol("locations", [], "code", false);
  return (
    <>
      <PageHeader title={g ? `修改採購 ${g.lotCode}` : "新增生豆採購"} back={g ? { href: `/inventory/lot/?id=${g.invLotId}`, label: g.lotCode } : { href: "/green/", label: "生豆來源" }} />
      {g && (
        <div className="mb-4">
          <Notice>
            <span title="入庫量改變時以差額調整庫存；成本改變時，熟豆尚未分裝出貨的烘焙批次會重算成本；批次編號、供應商會同步到烘焙紀錄">修改後，庫存、成本與烘焙紀錄會自動一起更新。</span>
          </Notice>
        </div>
      )}
      {editId && cur.loading ? (
        <p className="text-sm text-muted">載入中…</p>
      ) : editId && !g ? (
        <Notice tone="warning">找不到這筆生豆採購（可能已被刪除）。</Notice>
      ) : coffees.length === 0 ? (
        <Notice tone="warning">
          <span className="flex flex-wrap items-center justify-between gap-3">
            還沒有咖啡豆，請先建立一支。
            <LinkButton size="sm" href={withNext("/coffees/new/", next ? withNext("/green/new/", next) : "/green/new/")}>
              ＋ 新增咖啡豆
            </LinkButton>
          </span>
        </Notice>
      ) : (
        <EntityForm
          key={`${coffees.length}-${suppliers.data.length}-${locations.data.length}-${g?.updatedAt ?? ""}`}
          draftKey={g ? undefined : "green-new"}
          submitLabel={g ? "儲存修改" : "入庫"}
          successMessage={g ? "已更新生豆採購" : "生豆已入庫"}
          sections={[
            { key: "a", title: "採購資訊" },
            { key: "b", title: "數量與成本" },
            { key: "c", title: "品質與儲存" },
          ]}
          defaultValues={
            g
              ? {
                  ...Object.fromEntries(["coffeeId", "supplierId", "purchaseDate", "invoiceNo", "lotCode", "purchasedWeightG", "receivedWeightG", "unitPricePerKg", "shippingCost", "otherCost", "moisturePercent", "densityGPerL", "waterActivity", "locationId", "note"].map((k) => [k, g[k] == null ? "" : String(g[k]).replace(/^(-?\d+)\.(\d*?)0+$/, (_, a: string, b: string) => (b ? `${a}.${b}` : a))])),
                  receivedAt: toTaipeiLocalInput(new Date(g.receivedAt as string)),
                }
              : { coffeeId: coffee ?? "", purchaseDate: todayTaipei(), receivedAt: nowTaipeiLocal(), shippingCost: "0", otherCost: "0" }
          }
          fields={[
            { name: "coffeeId", label: "咖啡豆", type: "select", required: true, options: coffees, section: "a" },
            { name: "supplierId", label: "供應商", type: "select", options: suppliers.data.map((s) => ({ value: s.id, label: s.name })), section: "a" },
            { name: "purchaseDate", label: "採購日期", type: "date", required: true, section: "a" },
            { name: "receivedAt", label: "入庫時間", type: "datetime", required: true, section: "a" },
            { name: "invoiceNo", label: "發票／單據號碼", section: "a" },
            { name: "lotCode", label: "批次編號", hint: "留空則自動產生（GB-日期-序號）", section: "a" },
            { name: "purchasedWeightG", label: "採購數量", type: "number", unit: "g", required: true, section: "b" },
            { name: "receivedWeightG", label: "實際入庫數量", type: "number", unit: "g", required: true, hint: "實際秤重，作為庫存與成本分母", section: "b" },
            { name: "unitPricePerKg", label: "單價（每公斤）", type: "number", unit: "TWD", required: true, section: "b" },
            { name: "shippingCost", label: "運費", type: "number", unit: "TWD", section: "b" },
            { name: "otherCost", label: "其他採購費用", type: "number", unit: "TWD", section: "b" },
            { name: "moisturePercent", label: "含水率", type: "number", unit: "%", section: "c" },
            { name: "densityGPerL", label: "密度", type: "number", unit: "g/L", section: "c" },
            { name: "waterActivity", label: "水活性（選填）", type: "number", unit: "aw", section: "c" },
            { name: "locationId", label: "儲存位置", type: "select", options: locations.data.map((l) => ({ value: l.id, label: l.name })), section: "c" },
            { name: "note", label: "備註", type: "textarea", wide: true, section: "c" },
          ]}
          action={g ? opAction("green.update", { id: g.id }, () => `/inventory/lot/?id=${g.invLotId}`) : opAction("green.receive", undefined, (d) => next ?? `/inventory/lot/?id=${d.lotId}`)}
        />
      )}
    </>
  );
}
