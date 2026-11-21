import { createHash } from "node:crypto";
import { DomainError } from "../../../src/lib/errors";
import { toDb } from "../../../src/lib/decimal";
import { nowIso, newId, type Tx } from "../tx";
import { C, type Actor } from "../types";
import { audit } from "./core";
import type { ParseResult } from "../curves/parse";

export const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");
const CHUNK = 1500;

/**
 * 保存曲線：中繼資料於 roastCurves，時序點分塊存於 roastCurves/{id}/chunks/{n}。
 * 重複匯入規則：同一批次 + 相同 SHA-256 → 拒絕；新檔案成為使用中曲線，舊曲線保留但停用。
 */
export async function saveCurve(
  tx: Tx,
  args: { roastBatchId: string; source: "MANUAL" | "CSV" | "ARTISAN_ALOG"; fileName?: string | null; storagePath?: string | null; fileSha256?: string | null; mapping?: object | null; parsed: ParseResult; importEvents?: boolean },
  actor: Actor,
) {
  const rb = await tx.must(C.roastBatches, args.roastBatchId, "烘焙批次");
  if (args.fileSha256) {
    const uniqId = `curve:${rb.id}:${args.fileSha256}`;
    const dup = await tx.get(C.uniq, uniqId);
    if (dup) throw new DomainError(`此檔案已於 ${String(dup.at).slice(0, 10)} 匯入過本批次（重複匯入已拒絕）`, "DUPLICATE_IMPORT", 409);
    tx.set(C.uniq, uniqId, { kind: "curve", value: args.fileSha256, at: nowIso() });
  }
  for (const c of await tx.query(C.roastCurves, [["roastBatchId", "==", rb.id], ["isActive", "==", true]])) await tx.update(C.roastCurves, c.id, { isActive: false });
  const id = newId();
  const n = (v: number | null, dp: number) => (v == null ? null : Number(toDb(v, dp)));
  const pts = args.parsed.points.map((p) => ({ t: n(p.timeSec, 2), bt: n(p.btC, 1), et: n(p.etC, 1), ror: n(p.rorC, 2), heat: n(p.heat, 2), air: n(p.airflow, 2), drum: n(p.drumSpeed, 2) }));
  const chunks = Math.ceil(pts.length / CHUNK);
  for (let i = 0; i < chunks; i++) tx.set(`${C.roastCurves}/${id}/chunks`, String(i), { points: pts.slice(i * CHUNK, (i + 1) * CHUNK) });
  const curve = tx.set(C.roastCurves, id, {
    roastBatchId: rb.id,
    batchNo: rb.batchNo,
    source: args.source,
    originalFileName: args.fileName ?? null,
    storagePath: args.storagePath ?? null,
    fileSha256: args.fileSha256 ?? null,
    columnMapping: args.mapping ?? null,
    pointCount: pts.length,
    chunkCount: chunks,
    rorComputed: args.parsed.rorComputed,
    isActive: true,
    importedAt: nowIso(),
  });
  if (args.importEvents && args.parsed.events.length) {
    const events = [...((rb.events as unknown[]) ?? []), ...args.parsed.events.map((e) => ({ id: newId(), timeSec: Math.round(e.timeSec), type: e.type, btC: e.btC == null ? null : toDb(e.btC, 1), etC: e.etC == null ? null : toDb(e.etC, 1), heat: null, airflow: null, drumSpeed: null, note: "由曲線檔匯入" }))];
    await tx.update(C.roastBatches, rb.id, { events });
  }
  audit(tx, actor, "curve.import", "RoastCurve", id, `匯入曲線 ${args.fileName ?? "(手動)"} 至 ${rb.batchNo}，${pts.length} 點`);
  return curve;
}
