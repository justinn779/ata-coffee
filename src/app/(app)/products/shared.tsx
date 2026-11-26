"use client";

import { D, Decimal } from "@/lib/decimal";
import { opAction } from "@/lib/api";
import { useCol, type Row } from "@/lib/data";
import { opts, PRODUCT_CATEGORY, PRODUCT_STATUS, STOCK_POLICY } from "@/lib/labels";
import { formDefaults, useCoffeeOptions, useVariantOptions } from "@/lib/page";
import { EntityForm } from "@/components/entity-form";

/** 各 SKU 可售量：單品 = AVAILABLE 批次 (在庫 − 保留)；套組 = min(組件可售 ÷ 數量)（僅顯示，不另外保留） */
export function useAvailability() {
  const lots = useCol("invLots", [["kind", "FINISHED"]]);
  const variants = useCol("variants");
  const map = new Map<string, Decimal>();
  for (const l of lots.data) if (l.status === "AVAILABLE") map.set(l.variantId, (map.get(l.variantId) ?? D(0)).add(D(l.onHand).sub(l.reserved)));
  for (const v of variants.data) if (v.isBundle && (v.bundleComponents ?? []).length) map.set(v.id, Decimal.min(...(v.bundleComponents as Row[]).map((c) => (map.get(c.variantId) ?? D(0)).div(c.quantity).floor())));
  return map;
}

/** 簡單版新增商品：商品與規格一次建好 */
export function QuickProductForm() {
  const coffees = useCoffeeOptions();
  const materials = useCol("materials", [], "code", false);
  const mats = [{ value: "", label: "（不用）" }, ...materials.data.map((m) => ({ value: m.id, label: m.name }))];
  return (
    <EntityForm
      key={`${coffees.length}-${materials.data.length}`}
      draftKey="product-quick"
      submitLabel="建立商品"
      defaultValues={{ category: "COFFEE_BEAN", sizes: [{ name: "", fillWeightG: "", salePrice: "", materialId: "", materialId2: "" }] }}
      sections={[{ key: "a", title: "商品" }, { key: "b", title: "要賣的規格", description: "每一種包裝大小一列，例如「100g」「200g」「濾掛 10 入」。包材選了，分裝時會自動扣袋子、標籤。" }]}
      fields={[
        { name: "name", label: "商品名稱", required: true, placeholder: "例：耶加雪菲 水洗", section: "a" },
        { name: "coffeeId", label: "用哪支咖啡豆", type: "select", options: [{ value: "", label: "（不是咖啡豆商品）" }, ...coffees], section: "a" },
        { name: "category", label: "分類", type: "select", required: true, options: opts(PRODUCT_CATEGORY), section: "a" },
        {
          name: "sizes",
          label: "規格",
          type: "array",
          section: "b",
          addLabel: "再加一種規格",
          newItem: { name: "", fillWeightG: "", salePrice: "", materialId: "", materialId2: "" },
          itemFields: [
            { name: "name", label: "規格名稱", required: true, placeholder: "例：100g" },
            { name: "fillWeightG", label: "每包重量", type: "number", unit: "g" },
            { name: "salePrice", label: "售價", type: "number", unit: "TWD", required: true },
            { name: "materialId", label: "包材 1（袋子）", type: "select", options: mats },
            { name: "materialId2", label: "包材 2（標籤）", type: "select", options: mats },
          ],
        },
      ]}
      action={opAction("product.quickCreate", undefined, (d) => `/products/view/?id=${d.id}`)}
    />
  );
}

const PKEYS = ["id", "code", "name", "category", "brandSeriesId", "coffeeId", "flavorNotes", "description", "status", "isLimited", "saleStartDate", "saleEndDate"];

export function ProductForm({ initial }: { initial?: Row }) {
  const coffees = useCoffeeOptions();
  const series = useCol("brandSeries", [], "code", false);
  return (
    <EntityForm
      key={`${coffees.length}-${series.data.length}`}
      draftKey={initial ? undefined : "product-new"}
      submitLabel={initial ? "儲存" : "建立商品"}
      defaultValues={{ status: "DRAFT", category: "COFFEE_BEAN", ...formDefaults(initial, PKEYS) }}
      sections={[{ key: "a", title: "商品資料" }, { key: "b", title: "販售設定" }]}
      fields={[
        { name: "id", label: "", type: "hidden" },
        { name: "name", label: "名稱", required: true, section: "a" },
        { name: "category", label: "分類", type: "select", required: true, options: opts(PRODUCT_CATEGORY), section: "a" },
        { name: "brandSeriesId", label: "品牌系列", type: "select", options: series.data.map((s) => ({ value: s.id, label: `${s.code} ${s.name}` })), section: "a" },
        { name: "coffeeId", label: "對應咖啡豆", type: "select", options: coffees, section: "a", hint: "咖啡豆／濾掛必填，分裝時用於防止換豆" },
        { name: "flavorNotes", label: "風味說明", section: "a", wide: true },
        { name: "description", label: "商品介紹", type: "textarea", section: "a", wide: true },
        { name: "status", label: "上架狀態", type: "select", required: true, options: opts(PRODUCT_STATUS), section: "b" },
        { name: "isLimited", label: "期間限定商品", type: "checkbox", section: "b" },
        { name: "saleStartDate", label: "販售開始日期", type: "date", section: "b" },
        { name: "saleEndDate", label: "販售結束日期", type: "date", section: "b" },
      ]}
      action={opAction("product.save", undefined, (d) => `/products/view/?id=${d.id}`)}
    />
  );
}

export function VariantForm({ productId, initial }: { productId: string; initial?: Row | null }) {
  const materials = useCol("materials", [], "code", false);
  const variants = useVariantOptions({ includeBundles: false });
  const d = initial
    ? {
        ...formDefaults(initial, ["id", "sku", "name", "listPrice", "salePrice", "standardCost", "fillWeightG", "isBundle", "stockPolicy", "status"]),
        materials: ((initial.materials as Row[]) ?? []).map((m) => ({ materialId: m.materialId, quantityPerUnit: String(m.quantityPerUnit) })),
        components: ((initial.bundleComponents as Row[]) ?? []).map((c) => ({ componentVariantId: c.variantId, quantity: String(c.quantity) })),
      }
    : { stockPolicy: "STOCK_ONLY", status: "ACTIVE", materials: [], components: [] };
  return (
    <EntityForm
      key={`${materials.data.length}-${variants.length}`}
      submitLabel={initial ? "儲存規格" : "建立規格"}
      defaultValues={{ productId, ...d }}
      sections={[
        { key: "a", title: "規格", description: "包裝大小、重量與售價" },
        { key: "b", title: "包材", description: "每包要用的袋子、標籤；分裝時自動扣除" },
        { key: "c", title: "進階設定（大多不用改）", description: "原價、庫存方式、套組／禮盒的組件" },
      ]}
      fields={[
        { name: "id", label: "", type: "hidden" },
        { name: "productId", label: "", type: "hidden" },
        { name: "name", label: "規格名稱", required: true, placeholder: "例：200g", section: "a" },
        { name: "fillWeightG", label: "每包重量", type: "number", unit: "g", section: "a" },
        { name: "salePrice", label: "售價", type: "number", unit: "TWD", required: true, section: "a" },
        { name: "status", label: "狀態", type: "select", required: true, options: opts(PRODUCT_STATUS), section: "a" },
        { name: "listPrice", label: "原價（留空＝售價）", type: "number", unit: "TWD", section: "c" },
        { name: "standardCost", label: "估計成本", type: "number", unit: "TWD", section: "c", hint: "僅供參考；實際成本由分裝時計算" },
        { name: "stockPolicy", label: "庫存方式", type: "select", required: true, options: opts(STOCK_POLICY), section: "c" },
        { name: "isBundle", label: "這是套組／禮盒（由其他規格組成）", type: "checkbox", section: "c" },
        { name: "materials", label: "包材", type: "array", section: "b", addLabel: "新增包材", itemFields: [{ name: "materialId", label: "包材", type: "select", required: true, options: materials.data.map((m) => ({ value: m.id, label: `${m.code}｜${m.name}` })) }, { name: "quantityPerUnit", label: "每件用量", type: "number", required: true }] },
        { name: "components", label: "組件", type: "array", section: "c", addLabel: "新增組件", itemFields: [{ name: "componentVariantId", label: "組件規格", type: "select", required: true, options: variants.filter((v) => v.value !== initial?.id) }, { name: "quantity", label: "數量", type: "number", required: true }] },
      ]}
      action={opAction("variant.save", undefined, () => `/products/view/?id=${productId}`)}
    />
  );
}
