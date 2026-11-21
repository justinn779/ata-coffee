import { createHash } from "node:crypto";
import type { CurveSource } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { toDb } from "@/lib/decimal";
import { DomainError, NotFoundError } from "@/lib/errors";
import { audit, type Actor } from "../domain/audit";
import type { ParseResult } from "./parse";

export const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

/**
 * 儲存曲線（原始檔 + 正規化時序資料）。
 * 重複匯入規則：同一烘焙批次 + 相同檔案 SHA-256 → 拒絕；
 * 不同檔案 → 新曲線設為使用中，舊曲線保留但停用（可切換）。
 */
export async function saveCurve(
  tx: Tx,
  args: {
    roastBatchId: string;
    source: CurveSource;
    fileName?: string;
    storageKey?: string;
    fileSha256?: string;
    mapping?: object;
    parsed: ParseResult;
    importEvents?: boolean;
  },
  actor: Actor,
) {
  const rb = await tx.roastBatch.findUnique({ where: { id: args.roastBatchId } });
  if (!rb) throw new NotFoundError("烘焙批次");
  if (args.fileSha256) {
    const dup = await tx.roastCurve.findUnique({ where: { roastBatchId_fileSha256: { roastBatchId: rb.id, fileSha256: args.fileSha256 } } });
    if (dup) throw new DomainError(`此檔案已於 ${dup.importedAt.toISOString().slice(0, 10)} 匯入過本批次（重複匯入已拒絕）`, "DUPLICATE_IMPORT", 409);
  }
  await tx.roastCurve.updateMany({ where: { roastBatchId: rb.id, isActive: true }, data: { isActive: false } });
  const curve = await tx.roastCurve.create({
    data: {
      roastBatchId: rb.id,
      source: args.source,
      originalFileName: args.fileName,
      storageKey: args.storageKey,
      fileSha256: args.fileSha256,
      columnMapping: args.mapping ?? undefined,
      pointCount: args.parsed.points.length,
      rorComputed: args.parsed.rorComputed,
    },
  });
  const n = (v: number | null, dp: number) => (v == null ? null : toDb(v, dp));
  const CHUNK = 1000;
  for (let i = 0; i < args.parsed.points.length; i += CHUNK) {
    await tx.roastCurvePoint.createMany({
      data: args.parsed.points.slice(i, i + CHUNK).map((p) => ({
        curveId: curve.id,
        timeSec: toDb(p.timeSec, 2),
        btC: n(p.btC, 1),
        etC: n(p.etC, 1),
        rorC: n(p.rorC, 2),
        heat: n(p.heat, 2),
        airflow: n(p.airflow, 2),
        drumSpeed: n(p.drumSpeed, 2),
      })),
    });
  }
  if (args.importEvents && args.parsed.events.length) {
    await tx.roastEvent.createMany({
      data: args.parsed.events.map((e) => ({ roastBatchId: rb.id, timeSec: Math.round(e.timeSec), type: e.type, btC: n(e.btC, 1), etC: n(e.etC, 1), note: "由曲線檔匯入" })),
    });
  }
  await audit(tx, actor, "curve.import", "RoastCurve", curve.id, `匯入曲線 ${args.fileName ?? "(手動)"} 至 ${rb.batchNo}，${args.parsed.points.length} 點`);
  return curve;
}
