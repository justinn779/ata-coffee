import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 健康檢查（不含任何敏感資訊） */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "ok", time: new Date().toISOString() });
  } catch {
    return Response.json({ status: "error", db: "unreachable" }, { status: 503 });
  }
}
