import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

async function pickSku(page: Page, sku: string) {
  const sel = page.locator('select[name="items.0.variantId"]');
  await expect(sel.locator("option", { hasText: sku })).toHaveCount(1);
  await sel.selectOption((await sel.locator("option", { hasText: sku }).getAttribute("value"))!);
}

test("手動訂單 → 確認匯款（不重複）→ 出貨 → 批次追溯", async ({ page }) => {
  await page.goto("orders/new/");
  await page.getByLabel("顧客名稱").fill("E2E 測試顧客");
  await pickSku(page, "DRIP-YRG-1");
  await page.locator('input[name="items.0.quantity"]').fill("1");
  await page.getByRole("button", { name: "建立訂單並保留庫存" }).click();
  await expect(page).toHaveURL(/\/orders\/view\/\?id=/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("訂單 SO-");
  await expect(page.getByText("可出貨").first()).toBeVisible();
  await expect(page.getByText("已保留").first()).toBeVisible();

  await page.getByRole("button", { name: "確認匯款" }).click();
  await page.getByLabel("匯款參考（末五碼等）").fill("E2E01");
  await page.getByRole("dialog").getByRole("button", { name: "確認" }).click();
  await expect(page.getByText("已付款").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "確認匯款" })).toHaveCount(0);

  await page.getByRole("button", { name: "標記出貨" }).click();
  await page.getByLabel("追蹤號碼").fill("E2E-TRACK-1");
  await page.getByRole("dialog").getByRole("button", { name: "確認" }).click();
  await expect(page.getByText("已出貨").first()).toBeVisible();
  await expect(page.getByText("E2E-TRACK-1")).toBeVisible();
  await expect(page.getByText(/包裝 PK-/).first()).toBeVisible();
});

test("庫存不足時訂單不成立並顯示原因", async ({ page }) => {
  await page.goto("orders/new/");
  await page.getByLabel("顧客名稱").fill("E2E 超量");
  await pickSku(page, "ATA002-COL-100");
  await page.locator('input[name="items.0.quantity"]').fill("999");
  await page.getByRole("button", { name: "建立訂單並保留庫存" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /不可超賣|不足/ })).toBeVisible({ timeout: 60_000 });
});

test("烘焙批次：曲線 CSV 上傳 → 預覽 → 匯入 → 重複匯入被拒絕", async ({ page }) => {
  await page.goto("roasting/");
  await page.locator('main a[href*="/roasting/view/?id="]').first().click();
  await expect(page.getByText("匯入曲線").first()).toBeVisible();
  const file = path.join(__dirname, "..", "fixtures", "curve-valid.csv");
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole("button", { name: "驗證並預覽" }).click();
  await expect(page.getByText(/共 21 個資料點/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "確認匯入" }).click();
  await expect(page.getByText("曲線已匯入並保存原始檔")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("curve-valid.csv")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole("button", { name: "驗證並預覽" }).click();
  await expect(page.getByText("此檔案已匯入過本批次")).toBeVisible({ timeout: 60_000 });
});

test("錯誤曲線檔顯示具體行號", async ({ page }) => {
  await page.goto("roasting/");
  await page.locator('main a[href*="/roasting/view/?id="]').first().click();
  await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, "..", "fixtures", "curve-invalid.csv"));
  await page.getByRole("button", { name: "驗證並預覽" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /第 4 行/ })).toBeVisible({ timeout: 60_000 });
});

test("新增咖啡豆表單：必填驗證與建立", async ({ page }) => {
  await page.goto("coffees/new/");
  await page.getByRole("button", { name: "建立咖啡豆" }).click();
  await expect(page.getByText("請填寫代碼").first()).toBeVisible();
  await page.getByLabel("代碼").fill(`E2E-${Date.now()}`);
  await page.getByLabel("中文名稱").fill("E2E 測試豆");
  await page.getByRole("button", { name: "建立咖啡豆" }).click();
  await expect(page).toHaveURL(/\/coffees\/view\/\?id=/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E 測試豆");
});

test("出貨前修改訂單：改數量 → 重新保留，金額更新；付款後不可再修改", async ({ page }) => {
  await page.goto("orders/new/");
  await page.getByLabel("顧客名稱").fill("E2E 修改訂單");
  await pickSku(page, "DRIP-YRG-1");
  await page.locator('input[name="items.0.quantity"]').fill("1");
  await page.getByRole("button", { name: "建立訂單並保留庫存" }).click();
  await expect(page).toHaveURL(/\/orders\/view\/\?id=/, { timeout: 60_000 });
  await page.getByRole("link", { name: "修改訂單" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("修改訂單 SO-");
  await expect(page.locator('input[name="items.0.quantity"]')).toHaveValue("1");
  await page.locator('input[name="items.0.quantity"]').fill("3");
  await page.getByRole("button", { name: "儲存修改並重新保留庫存" }).click();
  await expect(page).toHaveURL(/\/orders\/view\/\?id=/, { timeout: 60_000 });
  await expect(page.getByRole("cell", { name: "3", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "確認匯款" })).toBeVisible();
  await expect(page.locator("main").getByText("NT$ 120", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "確認匯款" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "確認" }).click();
  await expect(page.getByText("已付款").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "修改訂單" })).toHaveCount(0);
});

test("杯測紀錄：修改分數與描述 → 刪除後回到列表", async ({ page }) => {
  await page.goto("cupping/");
  await page.locator('main a[href*="/cupping/view/?id="]').first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("杯測｜");
  await page.getByRole("link", { name: "修改", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("修改杯測");
  await page.getByLabel("文字描述").fill("E2E 修改後的描述");
  await page.getByRole("button", { name: "儲存修改" }).click();
  await expect(page).toHaveURL(/\/cupping\/view\/\?id=/, { timeout: 60_000 });
  await expect(page.getByText("E2E 修改後的描述")).toBeVisible();
  await page.getByRole("button", { name: "刪除" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "確認刪除" }).click();
  await expect(page).toHaveURL(/\/cupping\/$/, { timeout: 60_000 });
  await expect(page.getByText("E2E 修改後的描述")).toHaveCount(0);
});

test("個人帳號：顯示 Google 綁定狀態與綁定按鈕", async ({ page }) => {
  await page.goto("settings/?s=account");
  await expect(page.getByText("Google 帳號").first()).toBeVisible();
  await expect(page.getByText("未綁定", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "綁定 Google 帳號" })).toBeVisible();
});
