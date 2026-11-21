/**
 * 建立（或重設）管理員帳號 — 正式環境初始化用。
 * 密碼不會出現在命令列參數或程式碼中：由環境變數 ADMIN_PASSWORD 或互動式輸入提供。
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_NAME="管理員" npm run admin:create
 *   （未設定 ADMIN_PASSWORD 時會提示輸入，輸入不會顯示）
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import readline from "node:readline";

async function askHidden(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  out._writeToOutput = (s: string) => out.output.write(s.includes(q) ? s : "");
  return new Promise((res) => rl.question(q, (a) => (rl.close(), process.stdout.write("\n"), res(a))));
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  if (!email) throw new Error("請設定 ADMIN_EMAIL");
  const password = process.env.ADMIN_PASSWORD ?? (await askHidden("管理員密碼（至少 12 字元）："));
  if (password.length < 12) throw new Error("密碼至少 12 個字元");
  const prisma = new PrismaClient();
  const hash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, isActive: true },
    create: { email, name: process.env.ADMIN_NAME ?? "管理員", passwordHash: hash, role: "ADMIN" },
  });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.auditLog.create({ data: { action: "user.adminCreate", entityType: "User", entityId: user.id, summary: `以 CLI 建立／重設管理員 ${email}` } });
  console.log(`已建立／重設管理員：${email}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
