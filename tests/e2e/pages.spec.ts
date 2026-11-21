import { expect, test } from "@playwright/test";

/** 每個主要頁面與其第一筆詳細頁皆能正常開啟（無伺服器錯誤） */
const PAGES: Array<[string, RegExp]> = [
  ["/", /Dashboard/],
  ["/coffees", /咖啡豆資料/],
  ["/green", /生豆採購批次/],
  ["/roasting", /烘焙中心/],
  ["/roasting/compare", /烘焙曲線比較/],
  ["/cupping", /杯測實驗室/],
  ["/brewing", /手沖實驗室/],
  ["/brewing/recipes", /手沖實驗室/],
  ["/research", /研究專案/],
  ["/inventory", /庫存中心/],
  ["/inventory/ledger", /庫存帳本/],
  ["/production", /分裝生產/],
  ["/products", /商品與 SKU/],
  ["/orders", /訂單管理/],
  ["/customers", /顧客/],
  ["/reports", /成本與報表/],
  ["/series", /品牌系列與履歷/],
  ["/settings/defaults", /系統設定/],
  ["/settings/audit", /系統設定/],
  ["/coffees/new", /新增咖啡豆/],
  ["/green/new", /新增生豆採購/],
  ["/roasting/new", /開始新一批烘焙/],
  ["/cupping/new", /新增杯測/],
  ["/brewing/new", /新增手沖紀錄/],
  ["/production/new", /新增分裝單/],
  ["/orders/new", /建立手動訂單/],
];

for (const [path, heading] of PAGES) {
  test(`頁面可開啟：${path}`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.locator("text=Unhandled Runtime Error")).toHaveCount(0);
  });
}

for (const list of ["/coffees", "/roasting", "/cupping", "/brewing", "/research", "/production", "/products", "/orders", "/customers", "/series"]) {
  test(`詳細頁可開啟：${list}/[id]`, async ({ page }) => {
    await page.goto(list);
    const link = page.locator(`main a[href^="${list}/"]`).filter({ hasNotText: /新增|比較|配方|複製/ }).first();
    const href = await link.getAttribute("href");
    test.skip(!href, "沒有資料");
    const res = await page.goto(href!);
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}

test("未登入無法存取 API 與檔案", async ({ request, browser }) => {
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const r = await anon.request.get("/api/export/orders", { maxRedirects: 0 });
  expect(r.status()).toBe(401);
  const r2 = await anon.request.get("/orders", { maxRedirects: 0 });
  expect(r2.status()).toBe(307);
  const r3 = await anon.request.post("/api/storefront/v1/orders", { data: {} });
  expect(r3.status()).toBe(401);
  await anon.close();
  void request;
});
