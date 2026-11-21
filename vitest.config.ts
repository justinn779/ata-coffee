import { defineConfig } from "vitest/config";
import path from "node:path";
import { config } from "dotenv";

// 測試一律使用 .env.test（獨立的 ata_test 資料庫），絕不連線開發或正式資料庫
const testEnv = config({ path: ".env.test", override: true }).parsed ?? {};

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    env: testEnv,
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
