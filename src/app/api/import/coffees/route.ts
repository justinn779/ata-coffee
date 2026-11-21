import Papa from "papaparse";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorMessage } from "@/lib/errors";
import { requireActor } from "@/server/auth";
import { validateUpload } from "@/server/storage";

const FIELDS = ["code", "nameZh", "nameEn", "country", "region", "farm", "producer", "variety", "process", "altitude", "grade", "originFlavorNotes"] as const;

/** 匯入咖啡豆主檔（只新增，不覆寫既有代碼） */
export async function POST(req: Request) {
  let actor;
  try {
    actor = await requireActor();
  } catch {
    return new Response("未登入", { status: 401 });
  }
  try {
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) return new Response("請選擇檔案", { status: 400 });
    const buf = await validateUpload(file, "curve"); // 同為純文字 CSV 規則
    const { data } = Papa.parse<Record<string, string>>(buf.toString("utf8").replace(/^﻿/, ""), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
    let created = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const [i, row] of data.entries()) {
      const rec = Object.fromEntries(FIELDS.map((f) => [f, row[f]?.trim() || null])) as Record<(typeof FIELDS)[number], string | null>;
      if (!rec.code || !rec.nameZh) {
        errors.push(`第 ${i + 2} 行缺少 code 或 nameZh`);
        continue;
      }
      if (await prisma.coffee.findUnique({ where: { code: rec.code } })) {
        skipped++;
        continue;
      }
      await prisma.coffee.create({ data: { ...rec, code: rec.code, nameZh: rec.nameZh } });
      created++;
    }
    await prisma.auditLog.create({ data: { actorId: actor.userId, action: "data.import", entityType: "Coffee", summary: `匯入咖啡豆：新增 ${created}、略過 ${skipped}、錯誤 ${errors.length}` } });
    const url = new URL("/coffees", req.url);
    url.searchParams.set("imported", `${created}`);
    return NextResponse.redirect(url, 303);
  } catch (e) {
    return new Response(errorMessage(e), { status: 400 });
  }
}
