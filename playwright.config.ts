import { defineConfig, devices } from "@playwright/test";

/**
 * E2E：對「靜態建置（與 GitHub Pages 相同的 /ata-coffee/ 子路徑）＋ Firebase 模擬器（含示範資料）」執行。
 *   npm run test:e2e
 * 預設使用系統 Microsoft Edge（E2E_CHANNEL=chromium 可改用 Playwright 內建瀏覽器）。
 */
const channel = process.env.E2E_CHANNEL === "chromium" ? undefined : (process.env.E2E_CHANNEL ?? "msedge");
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:4173/ata-coffee/", channel, locale: "zh-TW", timezoneId: "Asia/Taipei", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "desktop", use: { ...devices["Desktop Edge"], channel, storageState: "tests/e2e/.auth/admin.json" }, dependencies: ["setup"], testIgnore: [/auth\.setup\.ts/, /mobile\.spec\.ts/, /public\.spec\.ts/] },
    { name: "mobile", use: { ...devices["Pixel 7"], channel, storageState: "tests/e2e/.auth/admin.json" }, dependencies: ["setup"], testMatch: /mobile\.spec\.ts/ },
    { name: "public", use: { ...devices["Desktop Edge"], channel }, testMatch: /public\.spec\.ts/ },
  ],
  webServer: { command: "node scripts/serve-static.mjs", url: "http://127.0.0.1:4173/ata-coffee/", reuseExistingServer: true },
});
