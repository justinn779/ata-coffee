/** 主檔與設定類寫入（皆在交易中執行並寫稽核紀錄） */
import { confirmOr, warn } from "../soft";
import { createHash, randomBytes } from "node:crypto";
import { D, toDb } from "../../../src/lib/decimal";
import { DomainError } from "../../../src/lib/errors";
import { nowIso, type Doc, type Tx } from "../tx";
import { C, type Actor, type InvLot } from "../types";
import { cascadeAfterSave } from "./cascade";
import { audit, nextNumber } from "./core";
import { createLot, ensureMaterialItem, ensureVariantItem, post } from "./inventory";

type Data = Record<string, unknown>;

/** 系統自動產生的編號前綴（新增時沒填編號就自動產生，例如 CF-001） */
export const AUTO_CODE: Record<string, string> = {
  [C.coffees]: "CF",
  [C.products]: "P",
  [C.variants]: "SKU",
  [C.series]: "S",
  [C.suppliers]: "SUP",
  [C.materials]: "M",
  [C.locations]: "L",
};

/** 產生下一個沒被用過的編號（略過以前手動取過的同名編號） */
async function nextFreeCode(tx: Tx, col: string, field: string, prefix: string) {
  for (let i = 0; i < 200; i++) {
    const code = await nextNumber(tx, prefix, { daily: false, pad: 3 });
    if (!(await tx.get("uniq", `${col}.${field}:${code}`.replace(/\//g, "∕")))) return code;
  }
  throw new DomainError("無法自動產生編號，請稍後再試");
}

/** 通用新增／更新：處理唯一欄位（code、sku…）與稽核；編號沒填時新增自動產生、修改沿用原本的 */
export async function upsert(tx: Tx, col: string, id: string | null | undefined, data: Data, actor: Actor, opts: { unique?: string; label: string }): Promise<Doc> {
  const now = nowIso();
  const before = id ? { ...(await tx.must(col, id, opts.label)) } : null;
  if (opts.unique && (data[opts.unique] == null || String(data[opts.unique]).trim() === "") && AUTO_CODE[col]) {
    data = { ...data, [opts.unique]: before ? before[opts.unique] : await nextFreeCode(tx, col, opts.unique, AUTO_CODE[col]) };
  }
  if (opts.unique) {
    const val = String(data[opts.unique]);
    if (id) {
      const prev = before!;
      if (prev[opts.unique] !== val) {
        await tx.claimUnique(`${col}.${opts.unique}`, val, `${opts.label}代碼「${val}」已存在`);
        await tx.releaseUnique(`${col}.${opts.unique}`, String(prev[opts.unique]));
      }
    } else await tx.claimUnique(`${col}.${opts.unique}`, val, `${opts.label}代碼「${val}」已存在`);
  }
  const doc: Doc = id ? await tx.update(col, id, { ...data, updatedAt: now }) : (tx.create(col, { ...data, createdAt: now, updatedAt: now }) as Doc);
  audit(tx, actor, `${col}.${id ? "update" : "create"}`, col, doc.id, `${id ? "更新" : "新增"}${opts.label}`);
  await cascadeAfterSave(tx, col, doc, before);
  return doc;
}

export async function saveVariant(tx: Tx, input: Data & { id?: string | null; productId: string; materials: Array<{ materialId: string; quantityPerUnit: string }>; components: Array<{ componentVariantId: string; quantity: string }> }, actor: Actor) {
  const { id, productId, materials, components, ...data } = input;
  const product = await tx.must(C.products, productId, "商品");
  if (data.isBundle && !components.length) throw new DomainError("套組至少需要一個組件");
  if (data.isBundle && data.stockPolicy === "MADE_TO_ORDER") throw new DomainError("套組第一版僅支援現貨（組件須有庫存）");
  if (!data.isBundle && data.stockPolicy === "MADE_TO_ORDER" && !data.fillWeightG) throw new DomainError("接單後分裝需設定填充重量");
  if (id) {
    const prev = await tx.must(C.variants, id, "品項");
    if (prev.isBundle !== data.isBundle && (await tx.query(C.orderItems, [["variantId", "==", id]], { limit: 1 })).length) confirmOr("已有訂單使用這個品項，切換套組／單品後，舊訂單仍照當時的內容出貨。仍要切換嗎？");
  }
  const bundleComponents = [];
  if (data.isBundle) {
    for (const c of components) {
      if (c.componentVariantId === id) throw new DomainError("套組不可包含自己");
      const cv = await tx.must(C.variants, c.componentVariantId, "組件品項");
      if (cv.isBundle) throw new DomainError("套組組件不可為另一個套組");
      if (!/^\d+$/.test(String(c.quantity)) || Number(c.quantity) <= 0) throw new DomainError("組件數量需為正整數");
      bundleComponents.push({ variantId: cv.id, sku: cv.sku, quantity: Number(c.quantity) });
    }
  }
  const mats = [];
  // 套組的包材＝禮盒、提袋等（商城下單時預留、出貨時扣除）；單品的包材＝分裝時扣除的袋子、標籤
  for (const m of materials) {
    const mm = await tx.must(C.materials, m.materialId, "包材");
    mats.push({ materialId: mm.id, materialName: mm.name, quantityPerUnit: toDb(m.quantityPerUnit, 3) });
  }
  const v = await upsert(tx, C.variants, id, { ...data, productId, productName: product.name, productStatus: product.status, coffeeId: product.coffeeId ?? null, category: product.category, brandSeriesId: product.brandSeriesId ?? null, isLimited: !!product.isLimited, materials: mats, bundleComponents }, actor, { unique: "sku", label: "品項編號" });
  if (!data.isBundle && data.stockPolicy !== "NOT_TRACKED") await ensureVariantItem(tx, v.id);
  return v;
}

/** 商品變更時同步 SKU 的反正規化欄位 */
export async function saveProduct(tx: Tx, input: Data & { id?: string | null }, actor: Actor) {
  const { id, ...data } = input;
  if (data.saleStartDate && data.saleEndDate && String(data.saleEndDate) < String(data.saleStartDate)) warn("販售結束日期早於開始日期，請確認");
  const variants = id ? await tx.query(C.variants, [["productId", "==", id]]) : [];
  if (id) {
    const prev = await tx.must(C.products, id, "商品");
    if (prev.coffeeId && prev.coffeeId !== data.coffeeId && (await tx.query(C.productionOrders, [["targetVariantId", "in", variants.map((v) => v.id).concat(["-"])]], { limit: 1 })).length) {
      warn("這個商品已有分裝紀錄，改了對應的咖啡豆後，之前分裝的成品仍是原本的豆子");
    }
  }
  const p = await upsert(tx, C.products, id, data, actor, { unique: "code", label: "商品" });
  for (const v of variants) await tx.update(C.variants, v.id, { productName: p.name, productStatus: p.status, coffeeId: p.coffeeId ?? null, category: p.category, brandSeriesId: p.brandSeriesId ?? null, isLimited: !!p.isLimited });
  return p;
}

export async function receiveMaterial(tx: Tx, input: { materialId: string; quantity: string; unitCost: string; note?: string | null }, actor: Actor) {
  const item = await ensureMaterialItem(tx, input.materialId);
  const m = await tx.must(C.materials, input.materialId, "包材");
  const lot = await createLot(tx, { itemId: item.id, lotCode: await nextNumber(tx, `MT-${m.code}`), unitCost: input.unitCost, producedAt: nowIso() });
  await post(tx, { lotId: lot.id, type: "RECEIPT", quantity: input.quantity, actor, note: input.note ?? "包材入庫", refType: "Material", refId: m.id });
  audit(tx, actor, "material.receive", "Material", m.id, `包材入庫 ${m.name} × ${input.quantity}`);
  return lot;
}

export async function setLotStatus(tx: Tx, input: { lotId: string; status: "AVAILABLE" | "HOLD"; note: string }, actor: Actor) {
  const lot = await tx.must<InvLot>(C.lots, input.lotId, "批次");
  if (lot.status === "QUARANTINE") confirmOr("這是退貨待檢批次，建議用退貨檢查流程處理。仍要直接改狀態嗎？");
  if (input.status === "HOLD" && D(lot.reserved).gt(0)) confirmOr(`這批還有 ${lot.reserved} 已保留給訂單或分裝，改為品質保留後那些保留仍在。仍要改嗎？`);
  await tx.update(C.lots, lot.id, { status: input.status, updatedAt: nowIso() });
  audit(tx, actor, "lot.status", "InvLot", lot.id, `${lot.status} → ${input.status}：${input.note}`);
}

export async function addExperiment(tx: Tx, input: { projectId: string; label: string; experimentDate: string; isBaseline: boolean; variableValues?: string | null; observation?: string | null; roastBatchId?: string | null }, actor: Actor) {
  const p = await tx.must(C.research, input.projectId, "研究專案");
  const exps = (p.experiments as Array<Data>) ?? [];
  const vars = Object.fromEntries((input.variableValues ?? "").split(/\n|；|;/).map((l) => l.split(/[:：=]/).map((x) => x.trim())).filter((kv) => kv.length === 2 && kv[0]));
  const rb = input.roastBatchId ? await tx.must(C.roastBatches, input.roastBatchId, "烘焙批次") : null;
  const next = [
    ...exps.map((e) => (input.isBaseline ? { ...e, isBaseline: false } : e)),
    { id: randomBytes(8).toString("hex"), version: exps.length + 1, label: input.label, isBaseline: input.isBaseline, experimentDate: input.experimentDate, variableValues: vars, observation: input.observation ?? null, roastBatchId: rb?.id ?? null, batchNo: rb?.batchNo ?? null },
  ];
  await tx.update(C.research, p.id, { experiments: next, updatedAt: nowIso() });
  audit(tx, actor, "research.experiment", "ResearchProject", p.id, `新增實驗 v${exps.length + 1} ${input.label}`);
}

/** 修改實驗版本（版本號不變；設為基準組時取消其他基準） */
export async function updateExperiment(tx: Tx, input: { projectId: string; expId: string; label: string; experimentDate: string; isBaseline: boolean; variableValues?: string | null; observation?: string | null; roastBatchId?: string | null }, actor: Actor) {
  const p = await tx.must(C.research, input.projectId, "研究專案");
  const exps = (p.experiments as Array<Data>) ?? [];
  const target = exps.find((e) => e.id === input.expId);
  if (!target) throw new DomainError("找不到實驗版本", "NOT_FOUND", 404);
  const vars = Object.fromEntries((input.variableValues ?? "").split(/\n|；|;/).map((l) => l.split(/[:：=]/).map((x) => x.trim())).filter((kv) => kv.length === 2 && kv[0]));
  const rb = input.roastBatchId ? await tx.must(C.roastBatches, input.roastBatchId, "烘焙批次") : null;
  const next = exps.map((e) =>
    e.id === input.expId
      ? { ...e, label: input.label, isBaseline: input.isBaseline, experimentDate: input.experimentDate, variableValues: vars, observation: input.observation ?? null, roastBatchId: rb?.id ?? null, batchNo: rb?.batchNo ?? null }
      : input.isBaseline
        ? { ...e, isBaseline: false }
        : e,
  );
  await tx.update(C.research, p.id, { experiments: next, updatedAt: nowIso() });
  audit(tx, actor, "research.experiment.update", "ResearchProject", p.id, `修改實驗 v${target.version} ${input.label}`);
}

export async function deleteExperiment(tx: Tx, projectId: string, expId: string, actor: Actor) {
  const p = await tx.must(C.research, projectId, "研究專案");
  const exps = (p.experiments as Array<Data>) ?? [];
  const target = exps.find((e) => e.id === expId);
  if (!target) throw new DomainError("找不到實驗版本", "NOT_FOUND", 404);
  await tx.update(C.research, p.id, { experiments: exps.filter((e) => e.id !== expId), updatedAt: nowIso() });
  audit(tx, actor, "research.experiment.delete", "ResearchProject", p.id, `刪除實驗 v${target.version} ${target.label}`);
}

export async function deleteResearch(tx: Tx, projectId: string, actor: Actor) {
  const p = await tx.must(C.research, projectId, "研究專案");
  await tx.delete(C.research, projectId);
  audit(tx, actor, "research.delete", "ResearchProject", projectId, `刪除研究專案 ${p.code ?? ""} ${p.name}`);
}

export async function setBaseline(tx: Tx, projectId: string, expId: string, actor: Actor) {
  const p = await tx.must(C.research, projectId, "研究專案");
  await tx.update(C.research, p.id, { experiments: ((p.experiments as Array<Data>) ?? []).map((e) => ({ ...e, isBaseline: e.id === expId })) });
  audit(tx, actor, "research.baseline", "ResearchProject", p.id, "設定基準組");
}

export async function createApiKey(tx: Tx, name: string, actor: Actor) {
  const prefix = "ata_" + randomBytes(6).toString("base64url").slice(0, 8);
  const secret = randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(prefix + secret).digest("hex");
  tx.set(C.apiKeys, hash, { name, prefix, scopes: ["orders:create", "products:read"], createdAt: nowIso(), lastUsedAt: null, revokedAt: null });
  audit(tx, actor, "apikey.create", "ApiKey", prefix, `建立 API 金鑰 ${name}（${prefix}…）`);
  return prefix + secret;
}

export const hashApiKey = (full: string) => createHash("sha256").update(full).digest("hex");

/** 首位管理員：只有在尚無任何管理員、且登入者 Email 等於部署時設定的 BOOTSTRAP_ADMIN_EMAIL 時才可成立 */
export async function claimFirstAdmin(tx: Tx, user: { uid: string; email?: string | null; name?: string | null }, bootstrapEmail: string | undefined) {
  if (!bootstrapEmail) throw new DomainError("系統尚未設定初始管理員 Email", "FORBIDDEN", 403);
  if (!user.email || user.email.toLowerCase() !== bootstrapEmail.toLowerCase()) throw new DomainError("此帳號不是指定的初始管理員", "FORBIDDEN", 403);
  const lock = await tx.get(C.uniq, "first-admin");
  if (lock) throw new DomainError("已有管理員，請由現有管理員授權", "FORBIDDEN", 403);
  tx.set(C.uniq, "first-admin", { uid: user.uid, at: nowIso() });
  tx.set(C.admins, user.uid, { email: user.email, name: user.name ?? "管理員", role: "ADMIN", createdAt: nowIso() });
  audit(tx, { userId: user.uid, name: user.name ?? user.email }, "admin.bootstrap", "Admin", user.uid, `初始管理員 ${user.email}`);
}
