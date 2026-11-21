import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Prisma.TransactionClient;

/** 以 Serializable 以外的預設 Read Committed 執行，並搭配 SELECT ... FOR UPDATE 列鎖保證一致性。 */
export function withTx<T>(fn: (tx: Tx) => Promise<T>, opts?: { timeout?: number }): Promise<T> {
  return prisma.$transaction(fn, { timeout: opts?.timeout ?? 20_000, maxWait: 10_000 });
}

/** 依 id 排序鎖定庫存批次列，避免死結。 */
export async function lockLots(tx: Tx, lotIds: string[]): Promise<void> {
  if (lotIds.length === 0) return;
  const ids = [...new Set(lotIds)].sort();
  await tx.$queryRaw`SELECT id FROM "InventoryLot" WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
}

/** 鎖定某庫存品項底下所有批次（保留可售量計算時使用）。 */
export async function lockItemLots(tx: Tx, itemId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "InventoryLot" WHERE "itemId" = ${itemId}::uuid ORDER BY id FOR UPDATE`;
}

export async function lockRow(tx: Tx, table: "SalesOrder" | "ProductionOrder" | "ReturnRecord", id: string) {
  // table 為白名單常數，非使用者輸入
  await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1::uuid FOR UPDATE`, id);
}
