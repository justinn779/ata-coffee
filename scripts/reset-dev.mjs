// 清空「本機開發」資料庫的所有資料表（保留 Schema 與 migration 紀錄），供重新 Seed。
// 安全限制：僅允許 127.0.0.1 / localhost，且 APP_ENV 不可為 production。
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL ?? "";
if (process.env.APP_ENV === "production" || !/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) {
  console.error("拒絕執行：只能清空本機開發資料庫（127.0.0.1 / localhost），且 APP_ENV 不可為 production。");
  process.exit(1);
}
const prisma = new PrismaClient();
const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
console.log(`已清空 ${tables.length} 個資料表（${url.replace(/:[^:@/]+@/, ":***@")}）`);
await prisma.$disconnect();
