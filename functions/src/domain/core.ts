import type { Tx } from "../tx";
import { nowIso } from "../tx";
import { C, type Actor } from "../types";
import { todayTaipei } from "../../../src/lib/time";

/** 稽核紀錄（安全規則禁止任何用戶端寫入；只能由 Functions 新增） */
export function audit(tx: Tx, actor: Actor, action: string, entityType: string, entityId: string | null, summary?: string, data?: unknown) {
  tx.create(C.audit, {
    actorId: actor.userId,
    actorName: actor.name ?? null,
    ip: actor.ip ?? null,
    action,
    entityType,
    entityId,
    summary: summary ?? null,
    data: data === undefined ? null : JSON.parse(JSON.stringify(data)),
    createdAt: nowIso(),
  });
}

/** 人類可讀編號：{prefix}-{YYYYMMDD}-{序號}，以計數文件在交易中原子遞增 */
export async function nextNumber(tx: Tx, prefix: string, opts?: { daily?: boolean; pad?: number }) {
  const daily = opts?.daily ?? true;
  const pad = opts?.pad ?? 3;
  const day = todayTaipei().replaceAll("-", "");
  const key = daily ? `${prefix}-${day}` : prefix;
  const cur = await tx.get<{ id: string; value: number }>(C.sequences, key);
  const value = (cur?.value ?? 0) + 1;
  tx.set(C.sequences, key, { value });
  const n = String(value).padStart(pad, "0");
  return daily ? `${prefix}-${day}-${n}` : `${prefix}-${n}`;
}

export interface AppSettings {
  tax: { mode: "INCLUSIVE" | "EXCLUSIVE" | "NONE"; rate: string };
  order: { requirePaymentBeforeShip: boolean };
  inventory: { lowGreenG: number; lowRoastedG: number; lowFinishedPcs: number; expiryWarnDays: number };
}
export const DEFAULT_SETTINGS: AppSettings = {
  tax: { mode: "INCLUSIVE", rate: "0.05" },
  order: { requirePaymentBeforeShip: true },
  inventory: { lowGreenG: 3000, lowRoastedG: 500, lowFinishedPcs: 5, expiryWarnDays: 14 },
};

export async function getSettings(tx: Tx): Promise<AppSettings> {
  const out = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, Record<string, unknown>>;
  for (const k of Object.keys(out)) {
    const d = await tx.get(C.settings, k);
    if (d) {
      const { id: _id, ...rest } = d;
      void _id;
      out[k] = { ...out[k], ...rest };
    }
  }
  return out as unknown as AppSettings;
}
