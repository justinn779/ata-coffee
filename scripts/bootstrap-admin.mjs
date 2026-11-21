// 正式環境首次啟動：若設定 ADMIN_EMAIL 與 ADMIN_PASSWORD，且該帳號尚不存在，就建立管理員。
// 已存在時不會修改（不會覆寫密碼）。建立後請到平台刪除 ADMIN_PASSWORD 環境變數。
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const email = process.env.ADMIN_EMAIL?.toLowerCase().trim();
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) process.exit(0);

const prisma = new PrismaClient();
try {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`[bootstrap-admin] 管理員 ${email} 已存在，略過（建議刪除 ADMIN_PASSWORD 環境變數）`);
  } else if (password.length < 12) {
    console.error("[bootstrap-admin] ADMIN_PASSWORD 至少 12 個字元，未建立管理員");
  } else {
    const u = await prisma.user.create({ data: { email, name: process.env.ADMIN_NAME || "管理員", passwordHash: await bcrypt.hash(password, 12), role: "ADMIN" } });
    await prisma.auditLog.create({ data: { action: "user.bootstrap", entityType: "User", entityId: u.id, summary: `首次啟動建立管理員 ${email}` } });
    console.log(`[bootstrap-admin] 已建立管理員 ${email}`);
  }
} finally {
  await prisma.$disconnect();
}
