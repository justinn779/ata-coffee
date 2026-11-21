import { execSync } from "node:child_process";
import { config } from "dotenv";

export default function setup() {
  const env = config({ path: ".env.test", override: true }).parsed!;
  if (!/ata_test/.test(env.DATABASE_URL)) throw new Error("拒絕執行：測試必須使用 ata_test 資料庫");
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, ...env, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
  });
}
