import type { TaxMode } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { prisma } from "@/lib/db";

export interface AppSettings {
  tax: { mode: TaxMode; rate: string };
  order: { requirePaymentBeforeShip: boolean };
  inventory: { lowGreenG: number; lowRoastedG: number; lowFinishedPcs: number; expiryWarnDays: number };
  brand: { name: string };
}

export const DEFAULT_SETTINGS: AppSettings = {
  tax: { mode: "INCLUSIVE", rate: "0.05" },
  order: { requirePaymentBeforeShip: true },
  inventory: { lowGreenG: 3000, lowRoastedG: 500, lowFinishedPcs: 5, expiryWarnDays: 14 },
  brand: { name: "ATA Coffee" },
};

export async function getSettings(tx: Tx | typeof prisma = prisma): Promise<AppSettings> {
  const rows = await tx.systemSetting.findMany();
  const out = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
  for (const r of rows) {
    if (r.key in out && typeof r.value === "object" && r.value) {
      out[r.key] = { ...(out[r.key] as object), ...(r.value as object) };
    }
  }
  return out as unknown as AppSettings;
}

export async function saveSetting<K extends keyof AppSettings>(tx: Tx | typeof prisma, key: K, value: AppSettings[K]) {
  await tx.systemSetting.upsert({ where: { key }, update: { value: value as object }, create: { key, value: value as object } });
}
