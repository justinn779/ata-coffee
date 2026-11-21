import { expect, test } from "@playwright/test";

const SETTINGS = ["account", "roasters", "suppliers", "equipment", "flavors", "templates", "materials", "locations", "defaults", "brand", "data", "admins", "api", "audit"];
const PAGES: Array<[string, RegExp]> = [
  ["./", /Dashboard/],
  ["coffees/", /咖啡豆資料/],
  ["green/", /生豆採購批次/],
  ["roasting/", /烘焙中心/],
  ["roasting/compare/", /烘焙曲線比較/],
  ["cupping/", /杯測實驗室/],
  ["cupping/compare/", /杯測比較/],
  ["brewing/", /手沖實驗室/],
  ["brewing/recipes/", /手沖實驗室/],
  ["brewing/compare/", /手沖比較/],
  ["research/", /研究專案/],
  ["inventory/", /庫存中心/],
  ["inventory/?kind=FINISHED", /庫存中心/],
  ["inventory/ledger/", /庫存帳本/],
  ["production/", /分裝生產/],
  ["products/", /商品與 SKU/],
  ["orders/", /訂單管理/],
  ["customers/", /顧客/],
  ["reports/", /成本與報表/],
  ["series/", /品牌系列與履歷/],
  ["coffees/new/", /新增咖啡豆/],
  ["green/new/", /新增生豆採購/],
  ["roasting/new/", /開始新一批烘焙/],
  ["cupping/new/", /新增杯測/],
  ["brewing/new/", /新增手沖紀錄/],
  ["production/new/", /新增分裝單/],
  ["products/new/", /新增商品/],
  ["orders/new/", /建立手動訂單/],
  ["customers/new/", /新增顧客/],
  ["research/new/", /新增研究專案/],
  ["series/new/", /新增品牌系列/],
  ...SETTINGS.map((s) => [`settings/?s=${s}`, /系統設定/] as [string, RegExp]),
];

const LISTS = ["coffees", "roasting", "cupping", "brewing", "research", "production", "products", "orders", "customers", "series"];

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => {
    throw new Error("頁面 JavaScript 錯誤：" + e.message);
  });
});

for (const [p, heading] of PAGES) {
  test(`頁面可開啟：${p}`, async ({ page }) => {
    await page.goto(p);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.getByText(/讀取失敗|沒有讀取權限/)).toHaveCount(0);
  });
}

for (const list of LISTS) {
  test(`詳細頁可開啟：${list}/view`, async ({ page }) => {
    await page.goto(`${list}/`);
    const link = page.locator(`main a[href*="/${list}/view/?id="]`).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/${list}/view/\\?id=`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/找不到資料|讀取失敗/)).toHaveCount(0);
  });
}

test("庫存批次頁與帳本", async ({ page }) => {
  await page.goto("inventory/?kind=ROASTED");
  await expect(page.getByText("對帳正常")).toBeVisible();
  await page.locator('main a[href*="/inventory/lot/?id="]').first().click();
  await expect(page.getByText("庫存帳本").first()).toBeVisible();
  await expect(page.getByText("烘焙產出").first()).toBeVisible();
});
