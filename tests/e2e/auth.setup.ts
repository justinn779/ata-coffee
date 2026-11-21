import { expect, test as setup } from "@playwright/test";

// 只存在於本機模擬器的示範帳號（scripts/seed-emulator.ts）
setup("管理員登入（Firebase Auth 模擬器）", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("電子郵件").fill("admin@ata.local");
  await page.getByLabel("密碼").fill("ata-demo-2026");
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  // Firebase Auth 狀態存在 IndexedDB
  await page.context().storageState({ path: "tests/e2e/.auth/admin.json", indexedDB: true });
});
