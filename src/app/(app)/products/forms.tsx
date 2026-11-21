import { prisma } from "@/lib/db";
import { EntityForm } from "@/components/entity-form";
import { opts, PRODUCT_CATEGORY, PRODUCT_STATUS, STOCK_POLICY } from "@/lib/labels";
import { coffeeOptions, variantOptions } from "@/server/options";
import { saveProduct, saveVariant } from "./actions";

const str = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? "" : String(v));

export async function ProductForm({ initial }: { initial?: Record<string, unknown> }) {
  const [coffees, series] = await Promise.all([coffeeOptions(), prisma.brandSeries.findMany({ orderBy: { code: "asc" } })]);
  return (
    <EntityForm
      draftKey={initial ? undefined : "product-new"}
      submitLabel={initial ? "儲存" : "建立商品"}
      defaultValues={{ status: "DRAFT", category: "COFFEE_BEAN", ...Object.fromEntries(Object.entries(initial ?? {}).map(([k, v]) => [k, typeof v === "boolean" ? v : str(v)])) }}
      sections={[{ key: "a", title: "商品資料" }, { key: "b", title: "販售設定" }]}
      fields={[
        { name: "id", label: "", type: "hidden" },
        { name: "code", label: "商品編號", required: true, section: "a" },
        { name: "name", label: "名稱", required: true, section: "a" },
        { name: "category", label: "分類", type: "select", required: true, options: opts(PRODUCT_CATEGORY), section: "a" },
        { name: "brandSeriesId", label: "品牌系列", type: "select", options: series.map((s) => ({ value: s.id, label: `${s.code} ${s.name}` })), section: "a" },
        { name: "coffeeId", label: "對應咖啡豆", type: "select", options: coffees, section: "a", hint: "咖啡豆／濾掛必填，分裝時用於防止換豆" },
        { name: "flavorNotes", label: "風味說明", section: "a", wide: true },
        { name: "description", label: "商品介紹", type: "textarea", section: "a", wide: true },
        { name: "status", label: "上架狀態", type: "select", required: true, options: opts(PRODUCT_STATUS), section: "b" },
        { name: "isLimited", label: "期間限定商品", type: "checkbox", section: "b" },
        { name: "saleStartDate", label: "販售開始日期", type: "date", section: "b" },
        { name: "saleEndDate", label: "販售結束日期", type: "date", section: "b" },
      ]}
      action={saveProduct}
    />
  );
}

export async function VariantForm({ productId, initial }: { productId: string; initial?: Awaited<ReturnType<typeof loadVariant>> }) {
  const [materials, variants] = await Promise.all([prisma.material.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }), variantOptions({ includeBundles: false })]);
  const d = initial
    ? {
        id: initial.id,
        sku: initial.sku,
        name: initial.name,
        listPrice: str(initial.listPrice),
        salePrice: str(initial.salePrice),
        standardCost: str(initial.standardCost),
        fillWeightG: str(initial.fillWeightG),
        isBundle: initial.isBundle,
        stockPolicy: initial.stockPolicy,
        status: initial.status,
        materials: initial.materials.map((m) => ({ materialId: m.materialId, quantityPerUnit: str(m.quantityPerUnit) })),
        components: initial.bundleComponents.map((c) => ({ componentVariantId: c.componentVariantId, quantity: String(c.quantity) })),
      }
    : { stockPolicy: "STOCK_ONLY", status: "ACTIVE", materials: [], components: [] };
  return (
    <EntityForm
      submitLabel={initial ? "儲存 SKU" : "建立 SKU"}
      defaultValues={{ productId, ...d }}
      sections={[
        { key: "a", title: "規格與價格", description: "售價由伺服器端讀取，訂單成立後保存價格快照" },
        { key: "b", title: "包材 BOM（單品）", description: "分裝完成時依此扣除包材" },
        { key: "c", title: "套組組件", description: "套組不另存庫存，下單時直接保留組件成品，不會與單品重複承諾同一份庫存" },
      ]}
      fields={[
        { name: "id", label: "", type: "hidden" },
        { name: "productId", label: "", type: "hidden" },
        { name: "sku", label: "SKU", required: true, section: "a" },
        { name: "name", label: "規格名稱", required: true, placeholder: "例：200g 咖啡豆", section: "a" },
        { name: "listPrice", label: "原價", type: "number", unit: "TWD", required: true, section: "a" },
        { name: "salePrice", label: "售價", type: "number", unit: "TWD", required: true, section: "a" },
        { name: "standardCost", label: "估計成本", type: "number", unit: "TWD", section: "a", hint: "僅供參考；實際成本來自批次" },
        { name: "fillWeightG", label: "每包填充重量", type: "number", unit: "g", section: "a" },
        { name: "stockPolicy", label: "庫存政策", type: "select", required: true, options: opts(STOCK_POLICY), section: "a" },
        { name: "status", label: "狀態", type: "select", required: true, options: opts(PRODUCT_STATUS), section: "a" },
        { name: "isBundle", label: "此 SKU 為套組／禮盒", type: "checkbox", section: "a" },
        { name: "materials", label: "包材", type: "array", section: "b", addLabel: "新增包材", itemFields: [{ name: "materialId", label: "包材", type: "select", required: true, options: materials.map((m) => ({ value: m.id, label: `${m.code}｜${m.name}` })) }, { name: "quantityPerUnit", label: "每件用量", type: "number", required: true }] },
        { name: "components", label: "組件", type: "array", section: "c", addLabel: "新增組件", itemFields: [{ name: "componentVariantId", label: "組件 SKU", type: "select", required: true, options: variants.filter((v) => v.value !== initial?.id) }, { name: "quantity", label: "數量", type: "number", required: true }] },
      ]}
      action={saveVariant}
    />
  );
}

export function loadVariant(id: string) {
  return prisma.productVariant.findUnique({ where: { id }, include: { materials: true, bundleComponents: true } });
}
