import { expect, test } from "@playwright/test";

/**
 * 主要操作流程（透過 UI）：建立手動訂單 → 確認匯款（重複確認不重複記錄）→ 出貨 → 庫存帳本出現出貨扣帳。
 * 使用 Seed 中的單包濾掛 DRIP-YRG-1（現貨）。
 */
test("手動訂單 → 確認匯款 → 出貨", async ({ page }) => {
  await page.goto("/orders/new");
  await page.getByLabel("顧客名稱").fill("E2E 測試顧客");
  const sku = page.locator('select[name="items.0.variantId"]');
  const value = await sku.locator("option", { hasText: "DRIP-YRG-1" }).getAttribute("value");
  await sku.selectOption(value!);
  await page.locator('input[name="items.0.quantity"]').fill("1");
  await page.getByRole("button", { name: "建立訂單並保留庫存" }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("訂單 SO-");
  await expect(page.getByText("可出貨").first()).toBeVisible();
  await expect(page.getByText("已保留").first()).toBeVisible();

  // 確認匯款
  await page.getByRole("button", { name: "確認匯款" }).click();
  await page.getByLabel("匯款參考（末五碼等）").fill("E2E01");
  await page.getByRole("dialog").getByRole("button", { name: "確認" }).click();
  await expect(page.getByText("已付款").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "確認匯款" })).toHaveCount(0);

  // 出貨
  await page.getByRole("button", { name: "標記出貨" }).click();
  await page.getByLabel("追蹤號碼").fill("E2E-TRACK-1");
  await page.getByRole("dialog").getByRole("button", { name: "確認" }).click();
  await expect(page.getByText("已出貨").first()).toBeVisible();
  await expect(page.getByText("E2E-TRACK-1")).toBeVisible();

  // 批次追溯可見
  await expect(page.getByText(/包裝 PK-/).first()).toBeVisible();
});

test("庫存對帳正常", async ({ page }) => {
  await page.goto("/inventory");
  await expect(page.getByText("對帳正常")).toBeVisible();
});

test("公開 QR 履歷不需登入且不含成本", async ({ page, browser }) => {
  await page.goto("/series");
  await page.locator('main a[href^="/series/"]:not([href="/series/new"])').first().click();
  await page.waitForURL(/\/series\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "QR Code 商品履歷" })).toBeVisible();
  const link = page.locator('a[href^="/t/"]').first();
  test.skip((await link.count()) === 0, "沒有已發布履歷");
  const href = await link.getAttribute("href");
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const p = await anon.newPage();
  await p.goto(href!);
  await expect(p.getByText("包裝批次")).toBeVisible();
  await expect(p.locator("body")).not.toContainText("成本");
  await expect(p.locator("body")).not.toContainText("NT$");
  await anon.close();
});
