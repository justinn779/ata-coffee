/**
 * Firestore 資料模型（集合名稱 → 文件型別）。
 * 十進位數為字串；時間為 ISO UTC 字串；日期為 'YYYY-MM-DD'。
 */
export const C = {
  admins: "admins",
  audit: "auditLogs",
  settings: "settings",
  sequences: "sequences",
  uniq: "uniq",
  suppliers: "suppliers",
  coffees: "coffees",
  greenPurchases: "greenPurchases",
  greenLots: "greenLots",
  roasters: "roasters",
  roastBatches: "roastBatches",
  roastCurves: "roastCurves",
  flavorTags: "flavorTags",
  cuppingTemplates: "cuppingTemplates",
  cuppings: "cuppingSessions",
  equipment: "equipment",
  brewRecipes: "brewRecipes",
  brews: "brewSessions",
  research: "researchProjects",
  locations: "locations",
  materials: "materials",
  items: "invItems",
  lots: "invLots",
  txs: "invTxs",
  reservations: "reservations",
  productionOrders: "productionOrders",
  packagingBatches: "packagingBatches",
  series: "brandSeries",
  products: "products",
  variants: "variants",
  customers: "customers",
  orders: "orders",
  orderItems: "orderItems",
  allocations: "allocations",
  payments: "payments",
  returns: "returns",
  costs: "costEntries",
  costRules: "costRules",
  traces: "traces",
  publicTraces: "publicTraces",
  brandAssets: "brandAssets",
  apiKeys: "apiKeys",
  stockCounts: "stockCounts",
  notifyLog: "notifyLog",
} as const;

export type InventoryKind = "GREEN" | "ROASTED" | "FINISHED" | "MATERIAL";
export type Unit = "G" | "PCS";
export type LotStatus = "AVAILABLE" | "QUARANTINE" | "HOLD" | "SCRAPPED";
export type TxType =
  | "RECEIPT"
  | "ROAST_ISSUE"
  | "ROAST_OUTPUT"
  | "CUPPING_USE"
  | "TASTING_USE"
  | "SAMPLE_GIFT"
  | "PACKAGING_ISSUE"
  | "PACKAGING_LOSS"
  | "PACKAGING_OUTPUT"
  | "MATERIAL_ISSUE"
  | "SCRAP"
  | "ADJUSTMENT"
  | "SHIPMENT_ISSUE"
  | "RETURN_QUARANTINE"
  | "RETURN_RESTOCK_OUT"
  | "RETURN_RESTOCK_IN"
  | "REVERSAL";

export interface InvItem {
  id: string;
  kind: InventoryKind;
  name: string;
  unit: Unit;
  coffeeId?: string | null;
  variantId?: string | null;
  materialId?: string | null;
  lowStockThreshold?: string | null;
  isActive: boolean;
  createdAt: string;
  [k: string]: unknown;
}

export interface InvLot {
  id: string;
  itemId: string;
  kind: InventoryKind;
  unit: Unit;
  itemName: string;
  lotCode: string;
  status: LotStatus;
  onHand: string;
  reserved: string;
  unitCost: string;
  locationId?: string | null;
  greenLotId?: string | null;
  roastBatchId?: string | null;
  packagingBatchId?: string | null;
  returnSourceLotId?: string | null;
  producedAt?: string | null;
  expiryDate?: string | null;
  expirySource?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
  [k: string]: unknown;
}

export interface InvTx {
  id: string;
  groupId: string;
  idempotencyKey?: string | null;
  itemId: string;
  lotId: string;
  kind: InventoryKind;
  lotCode: string;
  itemName: string;
  type: TxType;
  quantity: string;
  unit: Unit;
  unitCost: string;
  balanceAfter: string;
  refType?: string | null;
  refId?: string | null;
  note?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  reversesId?: string | null;
  reversedById?: string | null;
  occurredAt: string;
  [k: string]: unknown;
}

export interface Reservation {
  id: string;
  lotId: string;
  quantity: string;
  purpose: "ORDER" | "PRODUCTION";
  status: "ACTIVE" | "CONSUMED" | "RELEASED";
  orderItemId?: string | null;
  orderId?: string | null;
  productionOrderId?: string | null;
  note?: string | null;
  createdAt: string;
  releasedAt?: string | null;
  consumedAt?: string | null;
  [k: string]: unknown;
}

export interface Actor {
  userId: string | null;
  name?: string | null;
  ip?: string | null;
}
export const SYSTEM: Actor = { userId: null, name: "系統" };
