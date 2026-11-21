import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * 測試在 Firebase 模擬器上執行（專案 demo-ata-coffee，完全離線、不連線正式環境）：
 *   npm test   → firebase emulators:exec --only firestore,auth,storage "vitest run"
 */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", "tests/rules/**/*.test.ts"],
    env: {
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
      GCLOUD_PROJECT: "demo-ata-coffee",
    },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
