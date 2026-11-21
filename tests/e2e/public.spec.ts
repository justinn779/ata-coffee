import { expect, test } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
if (!getApps().length) initializeApp({ projectId: "demo-ata-coffee" });

test("未登入：管理頁顯示登入畫面，看不到任何資料", async ({ page }) => {
  await page.goto("orders/");
  await expect(page.getByRole("heading", { name: "管理員登入" })).toBeVisible();
  await expect(page.getByText("SO-")).toHaveCount(0);
});

test("公開 QR 履歷：不需登入、不含成本與顧客資料", async ({ page }) => {
  const snap = await getFirestore().collection("publicTraces").where("published", "==", true).limit(1).get();
  expect(snap.size).toBe(1);
  await page.goto(`t/?c=${snap.docs[0].id}`);
  await expect(page.getByText("包裝批次")).toBeVisible();
  await expect(page.getByText("PK-").first()).toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/成本|NT\$|示範顧客|0900/);
});

test("不存在的履歷代碼顯示找不到", async ({ page }) => {
  await page.goto("t/?c=notexist123");
  await expect(page.getByText("找不到此商品履歷")).toBeVisible();
});
