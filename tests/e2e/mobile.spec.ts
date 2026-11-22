import { expect, test } from "@playwright/test";

test("手機：抽屜導覽、卡片列表、無水平捲動", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "主畫面" })).toBeVisible();
  await page.getByRole("button", { name: "開啟選單" }).click();
  const drawer = page.getByRole("dialog", { name: "主選單" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "訂單管理" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("訂單管理");
  await expect(page.locator("main ul li a").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("手機：烘焙表單分段填寫", async ({ page }) => {
  await page.goto("roasting/new/");
  await expect(page.getByRole("button", { name: "1. 批次與重量" })).toBeVisible();
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByLabel("轉黃點")).toBeVisible();
});
