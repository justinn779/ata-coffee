import { defineConfig, devices } from "@playwright/test";

/**
 * E2E 測試：針對「已 Seed 的開發資料庫」執行（npm run db:seed）。
 * 預設連線 http://localhost:3000（若未啟動會自動執行 npm run dev）。
 * 示範帳密由環境變數提供：E2E_EMAIL / E2E_PASSWORD（預設為 seed 的本機示範帳號）。
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    // 預設使用系統已安裝的 Microsoft Edge（免下載瀏覽器）；可設 E2E_CHANNEL=chromium 改用 Playwright 內建瀏覽器
    channel: process.env.E2E_CHANNEL === "chromium" ? undefined : (process.env.E2E_CHANNEL ?? "msedge"),
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 90_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "desktop", use: { ...devices["Desktop Edge"], channel: process.env.E2E_CHANNEL === "chromium" ? undefined : (process.env.E2E_CHANNEL ?? "msedge"), storageState: "tests/e2e/.auth/admin.json" }, dependencies: ["setup"], testIgnore: [/auth\.setup\.ts/, /mobile\.spec\.ts/] },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: process.env.E2E_CHANNEL === "chromium" ? undefined : (process.env.E2E_CHANNEL ?? "msedge"), storageState: "tests/e2e/.auth/admin.json" }, dependencies: ["setup"], testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
