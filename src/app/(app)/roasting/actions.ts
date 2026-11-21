"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, withTx } from "@/lib/db";
import { errorMessage } from "@/lib/errors";
import { RoastEventType } from "@prisma/client";
import { boolStr, nativeEnumOf, optDec, optId, optInt, optMmSs, optStr, reqDateTime, reqDec, reqId } from "@/lib/zod";
import type { RoastExtraCost } from "@/server/domain/roasting";
import { action } from "@/server/action";
import { requireActor } from "@/server/auth";
import { audit } from "@/server/domain/audit";
import { createRoastBatch } from "@/server/domain/roasting";
import { saveCurve, sha256 } from "@/server/curves/import";
import { CurveParseError, detectMapping, parseArtisanAlog, parseCsvCurve, preprocessCsv, type ColumnMapping, type ParseResult } from "@/server/curves/parse";
import { putObject, validateUpload } from "@/server/storage";

const roastSchema = z.object({
  greenLotId: reqId("生豆批次"),
  roasterId: reqId("烘豆機"),
  roastedAt: reqDateTime("烘焙日期時間"),
  greenWeightG: reqDec("投入生豆重量", { positive: true }),
  roastedWeightG: reqDec("出爐熟豆重量", { positive: true }),
  chargeTempC: optDec("入豆溫"),
  turningPointSec: optMmSs("轉折點時間"),
  turningPointTempC: optDec("轉折點溫度"),
  dryEndSec: optMmSs("轉黃點"),
  firstCrackStartSec: optMmSs("一爆開始"),
  firstCrackEndSec: optMmSs("一爆結束"),
  dropSec: optMmSs("下豆時間"),
  dropTempC: optDec("下豆溫"),
  roastLevel: optStr(50),
  targetProfile: optStr(),
  result: optStr(),
  qualityRating: optInt("品質評價", 1, 10),
  note: optStr(),
  restStartDays: optInt("養豆開始天數", 0, 365),
  peakFromDays: optInt("最佳區間起", 0, 365),
  peakToDays: optInt("最佳區間迄", 0, 365),
  shelfLifeDays: optInt("保存期限", 1, 3650),
  energyCost: optDec("烘焙能源成本", { min: 0 }),
  energyIsEstimate: boolStr(),
  energyNote: optStr(),
  laborCost: optDec("烘焙人工成本", { min: 0 }),
  laborIsEstimate: boolStr(),
  copiedFromId: optId(),
  events: z
    .array(
      z.object({
        timeSec: optMmSs("事件時間"),
        type: nativeEnumOf(RoastEventType, "事件類型"),
        btC: optDec("BT"),
        etC: optDec("ET"),
        heat: optStr(50),
        airflow: optStr(50),
        drumSpeed: optStr(50),
        note: optStr(200),
      }),
    )
    .optional()
    .default([]),
});

export const createRoast = action(
  roastSchema,
  async (i, actor) => {
    const extra: RoastExtraCost[] = [];
    if (i.energyCost && Number(i.energyCost) > 0) extra.push({ category: "ROAST_ENERGY" as const, amount: i.energyCost, isEstimate: i.energyIsEstimate, calcNote: i.energyNote });
    if (i.laborCost && Number(i.laborCost) > 0) extra.push({ category: "ROAST_LABOR" as const, amount: i.laborCost, isEstimate: i.laborIsEstimate });
    const r = await withTx((tx) =>
      createRoastBatch(
        tx,
        {
          ...i,
          extraCosts: extra,
          events: i.events.filter((e) => e.timeSec != null).map((e) => ({ ...e, timeSec: e.timeSec! })),
        },
        actor,
      ),
    );
    return { id: r.batch.id, redirect: `/roasting/${r.batch.id}` };
  },
  { revalidate: ["/roasting", "/inventory", "/"] },
);

export const updateRoastNotes = action(
  z.object({ id: reqId("烘焙批次"), roastLevel: optStr(50), targetProfile: optStr(), result: optStr(), qualityRating: optInt("品質評價", 1, 10), note: optStr() }),
  async ({ id, ...data }, actor) => {
    await withTx(async (tx) => {
      await tx.roastBatch.update({ where: { id }, data });
      await audit(tx, actor, "roast.updateNotes", "RoastBatch", id, "更新烘焙評價與備註");
    });
    return { ok: true as const, message: "已更新（重量與時間等已過帳數據不可修改）" };
  },
  { revalidate: ["/roasting"] },
);

export const activateCurve = action(z.object({ curveId: reqId("曲線") }), async ({ curveId }, actor) => {
  await withTx(async (tx) => {
    const c = await tx.roastCurve.findUniqueOrThrow({ where: { id: curveId } });
    await tx.roastCurve.updateMany({ where: { roastBatchId: c.roastBatchId }, data: { isActive: false } });
    await tx.roastCurve.update({ where: { id: curveId }, data: { isActive: true } });
    await audit(tx, actor, "curve.activate", "RoastCurve", curveId, "切換使用中曲線");
  });
}, { revalidate: ["/roasting"] });

// ── 曲線匯入（FormData） ──

export interface CurvePreview {
  ok: boolean;
  error?: string;
  errors?: string[];
  format?: "CSV" | "ARTISAN_ALOG";
  headers?: string[];
  mapping?: ColumnMapping;
  pointCount?: number;
  sample?: ParseResult["points"];
  events?: ParseResult["events"];
  rorComputed?: boolean;
  warnings?: string[];
  duplicate?: boolean;
}

async function parseUpload(fd: FormData) {
  const file = fd.get("file");
  if (!(file instanceof File)) throw new CurveParseError(["請選擇檔案"]);
  const buf = await validateUpload(file, "curve");
  const text = buf.toString("utf8");
  const isAlog = file.name.toLowerCase().endsWith(".alog");
  if (isAlog) return { file, buf, format: "ARTISAN_ALOG" as const, headers: [] as string[], mapping: {} as ColumnMapping, parsed: parseArtisanAlog(text) };
  const { headers } = preprocessCsv(text);
  const raw = String(fd.get("mapping") ?? "");
  const mapping: ColumnMapping = raw ? JSON.parse(raw) : detectMapping(headers);
  const unit = fd.get("unit") === "F" ? "F" : "C";
  try {
    return { file, buf, format: "CSV" as const, headers, mapping, parsed: parseCsvCurve(text, mapping, unit) };
  } catch (e) {
    if (e instanceof CurveParseError) Object.assign(e, { headers, mapping });
    throw e;
  }
}

export async function previewCurve(fd: FormData): Promise<CurvePreview> {
  try {
    await requireActor();
  } catch {
    return { ok: false, error: "登入已逾時" };
  }
  try {
    const p = await parseUpload(fd);
    const roastBatchId = String(fd.get("roastBatchId") ?? "");
    const dup = roastBatchId ? await prisma.roastCurve.findFirst({ where: { roastBatchId, fileSha256: sha256(p.buf) } }) : null;
    return { ok: true, format: p.format, headers: p.headers, mapping: p.mapping, pointCount: p.parsed.points.length, sample: p.parsed.points.slice(0, 8), events: p.parsed.events, rorComputed: p.parsed.rorComputed, warnings: p.parsed.warnings, duplicate: !!dup };
  } catch (e) {
    if (e instanceof CurveParseError) {
      const extra = e as CurveParseError & { headers?: string[]; mapping?: ColumnMapping };
      return { ok: false, error: "檔案驗證失敗", errors: e.errors, headers: extra.headers, mapping: extra.mapping };
    }
    return { ok: false, error: errorMessage(e) };
  }
}

export async function importCurve(fd: FormData): Promise<{ ok: boolean; error?: string; errors?: string[] }> {
  let actor;
  try {
    actor = await requireActor();
  } catch {
    return { ok: false, error: "登入已逾時" };
  }
  try {
    const roastBatchId = z.string().uuid().parse(fd.get("roastBatchId"));
    const p = await parseUpload(fd);
    const hash = sha256(p.buf);
    const dup = await prisma.roastCurve.findFirst({ where: { roastBatchId, fileSha256: hash } });
    if (dup) return { ok: false, error: "此檔案已匯入過本批次（依 SHA-256 判斷），重複匯入已拒絕" };
    const key = await putObject(p.buf, "curves", p.file.name);
    await withTx(
      (tx) =>
        saveCurve(
          tx,
          { roastBatchId, source: p.format, fileName: p.file.name, storageKey: key, fileSha256: hash, mapping: p.mapping, parsed: p.parsed, importEvents: fd.get("importEvents") === "on" },
          actor,
        ),
      { timeout: 60_000 },
    );
    revalidatePath(`/roasting/${roastBatchId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof CurveParseError) return { ok: false, error: "檔案驗證失敗", errors: e.errors };
    return { ok: false, error: errorMessage(e) };
  }
}
