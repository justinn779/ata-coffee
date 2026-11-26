import { expect, test } from "@playwright/test";

/** 商城後台（管理員）：各頁可開啟；首頁內容修改後前台更新 */

test("商城後台各頁可開啟", async ({ page }) => {
  for (const [path, title] of [
    ["store/", "官方商城"],
    ["store/payments/", "付款對帳"],
    ["store/products/", "商城商品"],
    ["store/preorders/", "預購"],
    ["store/promotions/", "優惠"],
    ["store/content/", "首頁與內容"],
    ["store/settings/", "商城設定"],
    ["store/reports/", "電商報表"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }
});

test("付款對帳：待對帳的示範訂單可確認收款", async ({ page }) => {
  await page.goto("store/payments/");
  await expect(page.getByText("01234").first()).toBeVisible();
  await page.getByRole("button", { name: "確認收款" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "確認" }).click();
  await expect(page.getByText(/已確認(收款|付款)/).first()).toBeVisible();
});

test("後台修改首頁主視覺標題並發布後，前台更新", async ({ page }) => {
  await page.goto("store/content/");
  await page.getByRole("link", { name: "主視覺" }).click();
  const title = page.getByLabel("標題");
  await expect(title).toHaveValue(/用一杯咖啡/);
  await title.fill("冬日新豆上市（E2E）");
  await page.getByRole("button", { name: "儲存並發布" }).click();
  await expect(page.getByText("已發布")).toBeVisible();
  await page.goto("shop/");
  await expect(page.getByRole("heading", { name: "冬日新豆上市（E2E）" })).toBeVisible();
});

test("商城商品設定頁：顯示規格與自選禮盒設定", async ({ page }) => {
  await page.goto("store/products/");
  await page.getByRole("row", { name: /自選三入禮盒/ }).getByRole("link", { name: "設定" }).click();
  await expect(page.getByRole("heading", { name: /商城設定：自選三入禮盒/ })).toBeVisible();
  await expect(page.getByText("顧客自選內容（自選禮盒）")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "顧客自選內容（自選禮盒）" })).toBeChecked();
});
