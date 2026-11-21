import { expect, test } from "@playwright/test";

test("手機：抽屜導覽與卡片列表", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.getByRole("button", { name: "開啟選單" }).click();
  const drawer = page.getByRole("dialog", { name: "主選單" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "訂單管理" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("訂單管理");
  // 手機版不顯示桌面表格，改為卡片
  await expect(page.locator("table").first()).toBeHidden();
  // 無水平捲動
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("手機：烘焙表單分段填寫", async ({ page }) => {
  await page.goto("/roasting/new");
  await expect(page.getByRole("button", { name: "1. 批次與重量" })).toBeVisible();
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByLabel("轉黃點")).toBeVisible();
});
