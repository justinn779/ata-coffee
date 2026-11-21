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

test("忘記密碼：未填 Email 提示；填寫後顯示寄送說明（不透露帳號是否存在）", async ({ page }) => {
  await page.goto("orders/");
  await page.getByRole("button", { name: "忘記密碼？" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "請先在上方輸入電子郵件" })).toBeVisible();
  await page.getByLabel("電子郵件").fill("admin@ata.local");
  await page.getByRole("button", { name: "忘記密碼？" }).click();
  await expect(page.getByRole("status").filter({ hasText: "重設密碼信已寄出" })).toBeVisible();
  await page.getByLabel("電子郵件").fill("nobody@ata.local");
  await page.getByRole("button", { name: "忘記密碼？" }).click();
  await expect(page.getByRole("status").filter({ hasText: "重設密碼信已寄出" })).toBeVisible();
});

test("登入頁提供 Google 登入", async ({ page }) => {
  await page.goto("orders/");
  await expect(page.getByRole("button", { name: "使用 Google 登入" })).toBeVisible();
  await expect(page.getByText("Google 帳號需先由管理員")).toBeVisible();
});
