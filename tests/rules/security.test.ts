/**
 * 安全規則測試：證明即使繞過網頁、直接用 Firebase SDK 存取，也無法竄改資料。
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-ata-coffee",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
    storage: { rules: readFileSync("storage.rules", "utf8"), host: "127.0.0.1", port: 9199 },
  });
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "admins/admin1"), { email: "a@ata.test", role: "ADMIN" });
    await setDoc(doc(db, "invLots/lot1"), { onHand: "10.000", reserved: "0.000", lotCode: "L1" });
    await setDoc(doc(db, "invTxs/tx1"), { lotId: "lot1", quantity: "10.000", type: "RECEIPT" });
    await setDoc(doc(db, "orders/o1"), { customerName: "王小明", customerPhone: "0912" });
    await setDoc(doc(db, "publicTraces/pub1"), { published: true, batchNo: "PK-1" });
    await setDoc(doc(db, "publicTraces/hidden"), { published: false, batchNo: "PK-2" });
  });
});

const admin = () => env.authenticatedContext("admin1", { email: "a@ata.test" }).firestore();
const stranger = () => env.authenticatedContext("someone", { email: "x@evil.test" }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

describe("Firestore 規則", () => {
  it("管理員可讀取後台資料", async () => {
    await assertSucceeds(getDoc(doc(admin(), "invLots/lot1")));
    await assertSucceeds(getDocs(collection(admin(), "orders")));
  });
  it("未登入與非管理員不可讀取任何後台資料（含顧客個資）", async () => {
    await assertFails(getDoc(doc(anon(), "orders/o1")));
    await assertFails(getDoc(doc(stranger(), "orders/o1")));
    await assertFails(getDocs(collection(stranger(), "invLots")));
  });
  it("即使是管理員，也不能從瀏覽器直接修改庫存或帳本", async () => {
    await assertFails(updateDoc(doc(admin(), "invLots/lot1"), { onHand: "999" }));
    await assertFails(setDoc(doc(admin(), "invLots/lot2"), { onHand: "5" }));
    await assertFails(updateDoc(doc(admin(), "invTxs/tx1"), { quantity: "1" }));
    await assertFails(deleteDoc(doc(admin(), "invTxs/tx1")));
    await assertFails(addDoc(collection(admin(), "invTxs"), { quantity: "100" }));
    await assertFails(addDoc(collection(admin(), "auditLogs"), { action: "fake" }));
    await assertFails(updateDoc(doc(admin(), "orders/o1"), { paymentStatus: "PAID" }));
  });
  it("任何人都不能把自己加入管理員名單", async () => {
    await assertFails(setDoc(doc(stranger(), "admins/someone"), { role: "ADMIN" }));
    await assertFails(setDoc(doc(admin(), "admins/someone"), { role: "ADMIN" }));
  });
  it("公開 QR 履歷：已發布的可匿名讀取；未發布的不可；不可列出全部", async () => {
    await assertSucceeds(getDoc(doc(anon(), "publicTraces/pub1")));
    await assertFails(getDoc(doc(anon(), "publicTraces/hidden")));
    await assertFails(getDocs(collection(anon(), "publicTraces")));
    await assertFails(setDoc(doc(anon(), "publicTraces/pub1"), { published: true, batchNo: "fake" }));
  });
});

describe("Storage 規則", () => {
  const csv = new TextEncoder().encode("time,BT\n0,200\n30,150\n");
  it("管理員可上傳曲線檔到自己的資料夾", async () => {
    const s = env.authenticatedContext("admin1").storage();
    await assertSucceeds(uploadBytes(ref(s, "uploads/admin1/11111111-1111-1111-1111-111111111111.csv"), csv, { contentType: "text/csv" }));
  });
  it("非管理員、錯誤副檔名、他人資料夾、不允許的類型 → 拒絕", async () => {
    await assertFails(uploadBytes(ref(env.authenticatedContext("someone").storage(), "uploads/someone/11111111-1111-1111-1111-111111111111.csv"), csv, { contentType: "text/csv" }));
    const s = env.authenticatedContext("admin1").storage();
    await assertFails(uploadBytes(ref(s, "uploads/admin1/11111111-1111-1111-1111-111111111111.exe"), csv, { contentType: "application/octet-stream" }));
    await assertFails(uploadBytes(ref(s, "uploads/other/11111111-1111-1111-1111-111111111111.csv"), csv, { contentType: "text/csv" }));
    await assertFails(uploadBytes(ref(s, "brand/11111111-1111-1111-1111-111111111111.png"), csv, { contentType: "text/html" }));
  });
});
