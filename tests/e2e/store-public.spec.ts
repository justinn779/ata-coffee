import { expect, test, type Page } from "@playwright/test";

/**
 * 官方商城（顧客端，未登入）：使用模擬器示範資料。
 * 驗證完整購買流程、付款回報、訂單查詢、各寬度沒有水平溢出、私人頁不索引。
 */

async function noOverflow(page: Page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, "不可水平溢出").toBeLessThanOrEqual(r.cw + 1);
}

test("首頁：主視覺、本期選集、分類；沒有水平溢出", async ({ page }) => {
  await page.goto("shop/");
  await expect(page.getByRole("heading", { name: /用一杯咖啡/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "本期選集" })).toBeVisible();
  await expect(page.getByRole("link", { name: /ATA 001 晨光/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "ATA Coffee 首頁" })).toBeVisible();
  await noOverflow(page);
});

for (const w of [375, 390, 768, 1280, 1440]) {
  test(`版面寬度 ${w}px：首頁、列表、商品、購物袋、結帳、查詢沒有水平溢出`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    for (const path of ["shop/", "shop/products/", "shop/p/?s=yirgacheffe", "shop/p/?s=gift-box-3", "shop/cart/", "shop/lookup/", "shop/page/?k=guide"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await noOverflow(page);
    }
  });
}

test("完整購買流程：選研磨 → 購物袋 → 結帳 → 訂單成立 → 回報末五碼（保留前導零）", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("shop/p/?s=yirgacheffe");
  await expect(page.getByRole("heading", { name: /ATA 001 晨光/ })).toBeVisible();
  await page.getByRole("radio", { name: "免費代客研磨" }).click();
  await page.getByRole("combobox", { name: "沖煮方式" }).selectOption({ label: "義式" });
  // 手機版固定底部購買列
  const buy = page.getByRole("button", { name: "加入購物袋" }).last();
  await expect(buy).toBeInViewport();
  await buy.click();
  await expect(page.getByRole("link", { name: /購物袋，1 件商品/ })).toBeVisible();
  await page.goto("shop/cart/");
  await expect(page.getByText("研磨：義式")).toBeVisible();
  await expect(page.getByText("總計")).toBeVisible();
  await page.getByRole("link", { name: "前往結帳" }).click();
  await page.getByLabel("姓名（與證件相同，取貨需核對）").fill("E2E 測試");
  await page.getByLabel("手機").fill("0987654321");
  await page.getByLabel("Email（訂單通知）").fill("e2e@example.test");
  await page.getByRole("radio", { name: "全家" }).click();
  await page.getByLabel("店號").fill("135790");
  await page.getByLabel("門市名稱").fill("測試");
  await page.getByRole("button", { name: "送出訂單" }).click();
  await expect(page.getByText("請先閱讀並同意")).toBeVisible();
  await page.getByRole("checkbox").last().check();
  await page.getByRole("button", { name: "送出訂單" }).click();
  await expect(page.getByRole("heading", { name: "謝謝你的訂購" })).toBeVisible();
  await expect(page.getByText(/訂單 SO-/)).toBeVisible();
  await expect(page.getByText("測試環境：這是示範帳戶，請勿匯款。")).toBeVisible();
  await expect(page.getByText("全家 測試門市（135790）")).toBeVisible();
  await page.getByPlaceholder("00000").fill("00321");
  await page.getByRole("button", { name: "回報" }).click();
  await expect(page.getByText(/已收到付款回報（帳號末五碼 00321）/)).toBeVisible();
  await expect(page.getByRole("button", { name: "取消訂單" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /購物袋，0 件商品/ })).toBeVisible();
});

test("自選禮盒：選滿數量才能加入；售完與預購狀態", async ({ page }) => {
  await page.goto("shop/p/?s=gift-box-3");
  const add = page.getByRole("button", { name: /已選 0／3/ }).first();
  await expect(add).toBeDisabled();
  await page.getByRole("button", { name: /增加 ATA 002 午後/ }).click();
  await page.getByRole("button", { name: /增加 ATA 002 午後/ }).click();
  await page.getByRole("button", { name: /增加 晨光濾掛/ }).click();
  await page.getByRole("button", { name: "加入購物袋" }).first().click();
  await page.goto("shop/cart/");
  await expect(page.getByText(/ATA 002 午後｜哥倫比亞｜100g 咖啡豆 ×2/)).toBeVisible();
  await page.goto("shop/p/?s=guatemala-antigua");
  await expect(page.getByRole("button", { name: "已售完" }).first()).toBeDisabled();
  await page.goto("shop/p/?s=kenya-aa");
  await expect(page.getByText(/預購・\d+\/\d+ 出貨/).first()).toBeVisible();
});

test("訂單查詢：不依訂單編號直接顯示；錯誤資料與正確資料回覆相同訊息", async ({ page }) => {
  await page.goto("shop/lookup/");
  await page.getByLabel("訂單編號").fill("SO-00000000-999");
  await page.getByLabel("下單時填寫的 Email").fill("nobody@example.test");
  await page.getByRole("button", { name: "寄送驗證碼" }).click();
  await expect(page.getByText("如果訂單編號與 Email 正確，驗證碼已寄到你的信箱")).toBeVisible();
  await page.goto("shop/order/?t=invalid-token-000000000000000000000");
  await expect(page.getByText(/訂單連結(無效|已過期)/)).toBeVisible();
});

test("會員中心需要登入；私人頁面不讓搜尋引擎索引；測試登入只在模擬器出現", async ({ page }) => {
  await page.goto("shop/account/");
  await expect(page).toHaveURL(/shop\/login/);
  await expect(page.getByText("測試環境專用（正式環境不會出現）")).toBeVisible();
  for (const p of ["shop/cart/", "shop/checkout/", "shop/order/", "shop/lookup/", "shop/login/"]) {
    await page.goto(p);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  }
  await page.goto("shop/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index/);
});

test("測試會員登入後可看到歷史訂單；登出", async ({ page }) => {
  await page.goto("shop/login/");
  await page.getByRole("button", { name: "測試會員 A" }).click();
  await expect(page).toHaveURL(/shop\/account/);
  await expect(page.getByRole("heading", { name: "會員中心" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "我的訂單" })).toBeVisible();
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page).toHaveURL(/shop\/$/);
});

test("404 頁面", async ({ page }) => {
  const r = await page.goto("shop/not-a-page/");
  expect(r?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "找不到這個頁面" })).toBeVisible();
});
