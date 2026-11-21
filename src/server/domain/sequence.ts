import type { Tx } from "@/lib/db";
import { todayTaipei } from "@/lib/time";

/**
 * 產生人類可讀編號：{prefix}-{YYYYMMDD}-{序號}
 * 以 INSERT ... ON CONFLICT DO UPDATE 原子遞增，並行安全。
 */
export async function nextNumber(tx: Tx, prefix: string, opts?: { daily?: boolean; pad?: number }): Promise<string> {
  const daily = opts?.daily ?? true;
  const pad = opts?.pad ?? 3;
  const day = todayTaipei().replaceAll("-", "");
  const key = daily ? `${prefix}-${day}` : prefix;
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "DocumentSequence" (key, value) VALUES (${key}, 1)
    ON CONFLICT (key) DO UPDATE SET value = "DocumentSequence".value + 1
    RETURNING value`;
  const n = String(rows[0].value).padStart(pad, "0");
  return daily ? `${prefix}-${day}-${n}` : `${prefix}-${n}`;
}
