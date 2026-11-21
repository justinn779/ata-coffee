import { expect, test as setup } from "@playwright/test";

const email = process.env.E2E_EMAIL ?? "admin@ata.local";
const password = process.env.E2E_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? "ata-demo-2026";

setup("管理員登入", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.context().storageState({ path: "tests/e2e/.auth/admin.json" });
});
