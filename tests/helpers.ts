import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { runOp, type OpCtx } from "../functions/src/ops";
import { runTx } from "../functions/src/tx";
import { C, type Actor, type InvLot } from "../functions/src/types";
import { reconcile } from "../functions/src/domain/inventory";
import { D } from "../src/lib/decimal";

export const PROJECT = "demo-ata-coffee";
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("拒絕執行：測試必須連線 Firestore 模擬器");
if (!getApps().length) initializeApp({ projectId: PROJECT });
export const db: Firestore = getFirestore();
export const actor: Actor = { userId: "test-admin", name: "測試管理員" };

export const files = new Map<string, Buffer>();
export const ctx: OpCtx = {
  db,
  actor,
  readFile: async (p) => {
    const b = files.get(p);
    if (!b) throw new Error("file not found");
    return { buf: b, name: p };
  },
};

export async function resetDb() {
  const r = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  if (!r.ok) throw new Error("清空模擬器失敗");
  files.clear();
}

export const op = <T = Record<string, unknown>>(name: string, input: unknown) => runOp(name, input, ctx) as Promise<T>;
export const tx = <T>(fn: Parameters<typeof runTx<T>>[1]) => runTx(db, fn);

export async function lotOf(id: string) {
  const s = await db.collection(C.lots).doc(id).get();
  return { ...(s.data() as object), id } as InvLot;
}
export const n = (v: unknown) => D(v as string).toNumber();
export async function expectReconciled() {
  const diff = await reconcile(db);
  if (diff.length) throw new Error("對帳異常：" + JSON.stringify(diff));
}
export async function docs(col: string, field?: string, value?: unknown) {
  const s = field ? await db.collection(col).where(field, "==", value).get() : await db.collection(col).get();
  return s.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as Record<string, unknown> & { id: string });
}

/** 基本主檔：咖啡豆、烘豆機、包材（各 50）、商品與 SKU（100g 現貨、200g 可接單後分裝） */
export async function baseFixture(opts?: { variantPolicy?: "STOCK_ONLY" | "MADE_TO_ORDER" }) {
  const coffee = await op<{ id: string }>("coffee.save", { code: "ETH-YRG", nameZh: "耶加雪菲 水洗", country: "衣索比亞", shelfLifeDays: "180" });
  const roaster = await op<{ id: string }>("roaster.save", { name: "Olomo 測試機", brand: "Olomo", model: "TEST", maxCapacityG: "1200", tempChannels: "BT,ET" });
  const bag = await op<{ id: string }>("material.save", { code: "BAG-100", name: "100g 夾鏈袋", category: "BAG" });
  const label = await op<{ id: string }>("material.save", { code: "LBL-01", name: "標籤", category: "LABEL" });
  const bagLot = await op<{ lotId: string }>("inventory.receiveMaterial", { materialId: bag.id, quantity: "50", unitCost: "5" });
  const lblLot = await op<{ lotId: string }>("inventory.receiveMaterial", { materialId: label.id, quantity: "50", unitCost: "1" });
  const product = await op<{ id: string }>("product.save", { code: "P-YRG", name: "ATA 001 耶加雪菲", category: "COFFEE_BEAN", coffeeId: coffee.id, status: "ACTIVE" });
  const bom = [{ materialId: bag.id, quantityPerUnit: "1" }, { materialId: label.id, quantityPerUnit: "1" }];
  const v100 = await op<{ id: string }>("variant.save", { productId: product.id, sku: "YRG-100", name: "100g", listPrice: "450", salePrice: "420", fillWeightG: "100", stockPolicy: opts?.variantPolicy ?? "STOCK_ONLY", status: "ACTIVE", materials: bom });
  const v200 = await op<{ id: string }>("variant.save", { productId: product.id, sku: "YRG-200", name: "200g", listPrice: "800", salePrice: "780", fillWeightG: "200", stockPolicy: "MADE_TO_ORDER", status: "ACTIVE", materials: bom });
  return { coffee, roaster, bag, label, bagLotId: bagLot.lotId, lblLotId: lblLot.lotId, product, v100, v200 };
}

export async function receiveGreen(coffeeId: string, grams = 5000, pricePerKg = 600) {
  return op<{ id: string; lotId: string }>("green.receive", { coffeeId, purchaseDate: "2026-11-01", receivedAt: "2026-11-02T10:00", purchasedWeightG: String(grams), receivedWeightG: String(grams), unitPricePerKg: String(pricePerKg) });
}

export async function roast(greenLotId: string, roasterId: string, green = 500, roasted = 425) {
  const r = await op<{ id: string }>("roast.create", { greenLotId, roasterId, roastedAt: "2026-11-10T14:00", greenWeightG: String(green), roastedWeightG: String(roasted), dryEndSec: "4:00", firstCrackStartSec: "8:00", dropSec: "10:00" });
  const b = (await db.collection(C.roastBatches).doc(r.id).get()).data()!;
  return { batch: { ...b, id: r.id } as Record<string, any>, roastedLotId: b.invLotId as string }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function packageUnits(sourceLotId: string, variantId: string, qty: number, lossG = 0, fill?: string) {
  const po = await op<{ id: string }>("production.create", { sourceLotId, targetVariantId: variantId, plannedQty: String(qty), fillWeightG: fill, plannedDate: "2026-11-21" });
  await op("production.complete", { id: po.id, actualQty: String(qty), lossG: String(lossG) });
  const p = (await db.collection(C.productionOrders).doc(po.id).get()).data()!;
  const pkg = (await db.collection(C.packagingBatches).doc(p.packagingBatchId).get()).data()!;
  return { poId: po.id, lotId: p.outputLotId as string, packaging: { ...pkg, id: p.packagingBatchId as string } as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function order(variantId: string, quantity: number, key?: string) {
  return op<{ id: string; duplicate: boolean }>("order.create", { customerName: "測試顧客", items: [{ variantId, quantity: String(quantity) }], idempotencyKey: key });
}
export async function orderDoc(id: string) {
  return { ...((await db.collection(C.orders).doc(id).get()).data() as object), id } as Record<string, unknown> & { id: string };
}
