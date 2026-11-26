/**
 * 主檔修改的連動更新與刪除前的關聯檢查。
 * - 修改名稱等顯示欄位時，引用它的紀錄（烘焙、杯測、手沖、庫存品項與批次、訂單顧客資訊、公開履歷…）一併更新。
 * - 庫存帳本（invTxs）與盤點單是當下的快照，保留原文字不改寫。
 * - 刪除時若仍被其他資料使用，回報被哪些資料使用，請先處理或改用封存／停用。
 */
import { D } from "../../../src/lib/decimal";
import { DomainError } from "../../../src/lib/errors";
import { addDaysYmd } from "../../../src/lib/time";
import { type Doc, type Tx } from "../tx";
import { confirmOr } from "../soft";
import { C, type Actor } from "../types";
import { audit } from "./core";
import { KIND_LABEL } from "./inventory";
import { refreshPublishedTraces } from "./traceability";

type Filter = Parameters<Tx["query"]>[1];

async function patchAll(tx: Tx, col: string, filters: Filter, patch: (d: Doc) => Record<string, unknown> | null) {
  for (const d of await tx.query(col, filters)) {
    const p = patch(d);
    if (p && Object.entries(p).some(([k, v]) => d[k] !== v)) await tx.update(col, d.id, p);
  }
}

/** 庫存品項改名：品項與各批次的顯示名稱一起更新 */
async function renameItem(tx: Tx, itemId: string, name: string) {
  const it = await tx.get(C.items, itemId);
  if (!it) return;
  if (it.name !== name) await tx.update(C.items, itemId, { name });
  await patchAll(tx, C.lots, [["itemId", "==", itemId]], () => ({ itemName: name }));
}

/** 主檔儲存後的連動更新；prev 為修改前資料（新增時為 null） */
export async function cascadeAfterSave(tx: Tx, col: string, cur: Doc, prev: Doc | null) {
  if (!prev) return;
  const changed = (...keys: string[]) => keys.some((k) => prev[k] !== cur[k]);
  switch (col) {
    case C.coffees:
      if (changed("nameZh")) {
        for (const c of [C.roastBatches, C.greenLots, C.cuppings, C.brews]) await patchAll(tx, c, [["coffeeId", "==", cur.id]], () => ({ coffeeName: cur.nameZh }));
        for (const k of ["GREEN", "ROASTED"] as const) await renameItem(tx, `coffee-${k.toLowerCase()}-${cur.id}`, `${KIND_LABEL[k]}｜${cur.nameZh}`);
      }
      if (changed("shelfLifeDays")) {
        // 未覆寫保存期限的熟豆批次，依新的預設天數重算到期日
        for (const rb of await tx.query(C.roastBatches, [["coffeeId", "==", cur.id]])) {
          if (rb.shelfLifeDays != null || !rb.invLotId) continue;
          const lot = await tx.get(C.lots, rb.invLotId as string);
          if (!lot) continue;
          const days = cur.shelfLifeDays as number | null;
          await tx.update(C.lots, lot.id, { expiryDate: days != null ? addDaysYmd(new Date(rb.roastedAt as string), days) : null, expirySource: days != null ? "咖啡豆預設保存期限" : null });
        }
      }
      await refreshPublishedTraces(tx);
      break;
    case C.roasters:
      if (changed("name")) await patchAll(tx, C.roastBatches, [["roasterId", "==", cur.id]], () => ({ roasterName: cur.name }));
      break;
    case C.suppliers:
      if (changed("name")) for (const c of [C.greenLots, C.greenPurchases, C.coffees]) await patchAll(tx, c, [["supplierId", "==", cur.id]], () => ({ supplierName: cur.name }));
      break;
    case C.equipment:
      if (changed("name")) for (const f of ["grinder", "dripper", "filter"]) await patchAll(tx, C.brews, [[`${f}Id`, "==", cur.id]], () => ({ [`${f}Name`]: cur.name }));
      break;
    case C.customers:
      if (changed("name", "phone", "email")) await patchAll(tx, C.orders, [["customerId", "==", cur.id]], () => ({ customerName: cur.name, customerPhone: cur.phone ?? null, customerEmail: cur.email ?? null }));
      break;
    case C.materials:
      if (changed("name", "code")) {
        await renameItem(tx, `material-${cur.id}`, `${cur.name}（${cur.code}）`);
        for (const v of await tx.query(C.variants, [])) {
          const mats = (v.materials as Array<{ materialId: string; materialName: string }> | undefined) ?? [];
          if (mats.some((m) => m.materialId === cur.id)) await tx.update(C.variants, v.id, { materials: mats.map((m) => (m.materialId === cur.id ? { ...m, materialName: cur.name } : m)) });
        }
      }
      break;
    case C.flavorTags:
      if (changed("name")) {
        const swap = (tags: unknown) => (tags as string[]).map((t) => (t === prev.name ? (cur.name as string) : t));
        for (const c of [C.cuppings, C.brews]) await patchAll(tx, c, [["tags", "array-contains", prev.name]], (d) => ({ tags: swap(d.tags) }));
      }
      break;
    case C.cuppingTemplates:
      if (changed("name")) await patchAll(tx, C.cuppings, [["templateId", "==", cur.id]], () => ({ templateName: cur.name }));
      break;
    case C.products:
      for (const v of await tx.query(C.variants, [["productId", "==", cur.id]])) await cascadeVariant(tx, { ...v, productName: cur.name });
      await refreshPublishedTraces(tx);
      break;
    case C.variants:
      await cascadeVariant(tx, cur);
      await refreshPublishedTraces(tx);
      break;
    case C.series:
    case C.brewRecipes:
      await refreshPublishedTraces(tx);
      break;
  }
}

/** 商品品項名稱／SKU 變更：庫存品項、批次、生產單的顯示一起更新 */
async function cascadeVariant(tx: Tx, v: Doc) {
  await renameItem(tx, `variant-${v.id}`, `${v.productName}｜${v.name}（${v.sku}）`);
  await patchAll(tx, C.productionOrders, [["targetVariantId", "==", v.id]], () => ({ variantName: `${v.productName}｜${v.name}`, sku: v.sku }));
}

// ───────────── 刪除 ─────────────

type Ref = { col: string; field: string; label: string };
interface DeletableDef {
  label: string;
  /** 唯一欄位（刪除後釋放，讓代碼可以再用） */
  unique?: string;
  refs: Ref[];
  /** 其他無法以單一欄位查詢的關聯檢查；回傳被使用的說明 */
  extra?: (tx: Tx, d: Doc) => Promise<string[]>;
  /** 刪除後的清理 */
  cleanup?: (tx: Tx, d: Doc) => Promise<void>;
}

const hasStock = async (tx: Tx, itemId: string) => (await tx.query(C.lots, [["itemId", "==", itemId]])).length > 0;

/** 可刪除的主檔與其關聯（被使用時不可刪除） */
export const DELETABLE: Record<string, DeletableDef> = {
  [C.suppliers]: {
    label: "供應商",
    unique: "code",
    refs: [
      { col: C.greenLots, field: "supplierId", label: "生豆批次" },
      { col: C.coffees, field: "supplierId", label: "咖啡豆" },
    ],
  },
  [C.roasters]: { label: "烘豆機", unique: "name", refs: [{ col: C.roastBatches, field: "roasterId", label: "烘焙批次" }] },
  [C.equipment]: {
    label: "器材",
    refs: [
      { col: C.brews, field: "grinderId", label: "手沖紀錄（磨豆機）" },
      { col: C.brews, field: "dripperId", label: "手沖紀錄（濾杯）" },
      { col: C.brews, field: "filterId", label: "手沖紀錄（濾紙）" },
      { col: C.brewRecipes, field: "grinderId", label: "手沖配方" },
      { col: C.brewRecipes, field: "dripperId", label: "手沖配方" },
    ],
  },
  [C.flavorTags]: { label: "風味詞彙", unique: "name", refs: [] },
  [C.locations]: {
    label: "儲位",
    unique: "code",
    refs: [
      { col: C.lots, field: "locationId", label: "庫存批次" },
      { col: C.greenLots, field: "locationId", label: "生豆批次" },
    ],
  },
  [C.customers]: { label: "顧客", refs: [{ col: C.orders, field: "customerId", label: "訂單" }] },
  [C.series]: { label: "品牌系列", unique: "code", refs: [{ col: C.products, field: "brandSeriesId", label: "商品" }] },
  [C.products]: { label: "商品", refs: [{ col: C.variants, field: "productId", label: "品項（請先刪除品項）" }] },
  [C.variants]: {
    label: "商品品項",
    unique: "sku",
    refs: [
      { col: C.orderItems, field: "variantId", label: "訂單明細" },
      { col: C.productionOrders, field: "targetVariantId", label: "分裝生產單" },
    ],
    extra: async (tx, d) => {
      const out: string[] = [];
      if (await hasStock(tx, `variant-${d.id}`)) out.push("成品庫存批次");
      for (const v of await tx.query(C.variants, [])) if (((v.bundleComponents as Array<{ variantId?: string; componentVariantId?: string }> | undefined) ?? []).some((c) => (c.variantId ?? c.componentVariantId) === d.id)) out.push(`組合品項 ${v.sku}`);
      return out;
    },
    cleanup: async (tx, d) => {
      if ((await tx.get(C.items, `variant-${d.id}`)) && !(await hasStock(tx, `variant-${d.id}`))) await tx.delete(C.items, `variant-${d.id}`);
    },
  },
  [C.materials]: {
    label: "包材",
    unique: "code",
    refs: [],
    extra: async (tx, d) => {
      const out: string[] = [];
      if (await hasStock(tx, `material-${d.id}`)) out.push("包材庫存批次");
      for (const v of await tx.query(C.variants, [])) if (((v.materials as Array<{ materialId: string }> | undefined) ?? []).some((m) => m.materialId === d.id)) out.push(`品項 ${v.sku} 的包材設定`);
      return out;
    },
    cleanup: async (tx, d) => {
      if ((await tx.get(C.items, `material-${d.id}`)) && !(await hasStock(tx, `material-${d.id}`))) await tx.delete(C.items, `material-${d.id}`);
    },
  },
  [C.cuppingTemplates]: { label: "杯測評分模板", unique: "name", refs: [{ col: C.cuppings, field: "templateId", label: "杯測紀錄" }] },
  [C.brewRecipes]: {
    label: "手沖配方",
    refs: [
      { col: C.brews, field: "recipeId", label: "手沖紀錄" },
      { col: C.series, field: "recommendedRecipeId", label: "品牌系列推薦配方" },
    ],
  },
  [C.coffees]: {
    label: "咖啡豆",
    unique: "code",
    refs: [
      { col: C.greenLots, field: "coffeeId", label: "生豆批次" },
      { col: C.roastBatches, field: "coffeeId", label: "烘焙批次" },
      { col: C.products, field: "coffeeId", label: "商品" },
      { col: C.cuppings, field: "coffeeId", label: "杯測紀錄" },
      { col: C.brews, field: "coffeeId", label: "手沖紀錄" },
    ],
    cleanup: async (tx, d) => {
      for (const k of ["green", "roasted"]) if ((await tx.get(C.items, `coffee-${k}-${d.id}`)) && !(await hasStock(tx, `coffee-${k}-${d.id}`))) await tx.delete(C.items, `coffee-${k}-${d.id}`);
    },
  },
  [C.costRules]: { label: "成本分攤規則", refs: [] },
};

/** 刪除主檔：先檢查是否仍被使用 */
export async function deleteMaster(tx: Tx, col: string, id: string, actor: Actor) {
  const def = DELETABLE[col];
  if (!def) throw new DomainError("這類資料不能直接刪除");
  const d = await tx.must(col, id, def.label);
  const used = new Map<string, number>();
  for (const r of def.refs) {
    const n = (await tx.query(r.col, [[r.field, "==", id]])).length;
    if (n) used.set(r.label, (used.get(r.label) ?? 0) + n);
  }
  for (const x of (await def.extra?.(tx, d)) ?? []) used.set(x, (used.get(x) ?? 0) + 1);
  if (used.size) {
    const list = [...used].map(([k, n]) => `${k} ${n} 筆`).join("、");
    confirmOr(`這筆${def.label}還有 ${list} 用到。刪除後那些紀錄會保留，並標示「${def.label}已刪除」${col === C.coffees ? "（也可以改用「封存」）" : ""}。確定刪除嗎？`);
  }
  await def.cleanup?.(tx, d);
  if (def.unique && d[def.unique] != null) await tx.releaseUnique(`${col}.${def.unique}`, String(d[def.unique]));
  await tx.delete(col, id);
  audit(tx, actor, `${col}.delete`, col, id, `刪除${def.label}「${d.name ?? d.nameZh ?? d.code ?? d.sku ?? id}」`);
}

/** 刪除手動登記的營運費用（只限期間費用，烘焙／分裝／訂單成本請由原紀錄修改） */
export async function deleteCostEntry(tx: Tx, id: string, actor: Actor) {
  const c = await tx.must(C.costs, id, "成本紀錄");
  if (c.roastBatchId || c.productionOrderId || c.orderId) confirmOr("這筆成本屬於烘焙、分裝或訂單，建議到原紀錄修改；直接刪除後原紀錄的成本不會重算。仍要刪除嗎？");
  await tx.delete(C.costs, id);
  audit(tx, actor, "cost.delete", "CostEntry", id, `刪除營運費用 ${D(c.amount as string).toFixed(0)}：${c.calcNote ?? ""}`);
}

