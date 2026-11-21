# 系統架構（Firebase 版）

```
瀏覽器 ── GitHub Pages（Next.js 靜態匯出，純前端）
  │  讀取：Firestore 即時查詢（onSnapshot）── 受 Firestore 安全規則保護（只有管理員可讀）
  │  寫入：httpsCallable("api", { op, input }) ─────────────┐
  │  上傳：Cloud Storage（曲線原始檔、品牌素材）── 受 Storage 規則保護
  ▼                                                          ▼
Firebase Auth（Email／密碼）                     Cloud Functions（asia-east1）
                                                   api：驗證登入 → 檢查 admins/{uid} → Zod 驗證 → Domain
                                                   storefront：未來官網（API 金鑰）
                                                           ▼
                                                 Firestore 交易（Admin SDK）
```

## 原則

- **所有寫入只能經由 Cloud Functions。** Firestore 規則對所有集合 `allow write: if false`，瀏覽器即使繞過網頁也無法修改庫存、帳本、訂單、成本或管理員名單（`tests/rules/security.test.ts` 驗證）。
- **業務邏輯集中在 `functions/src/domain/*`**：inventory（帳本核心）、green、roasting、production、allocation、orders、lab、curves、reports、traceability、master。
- **前端不信任任何價格或成本**：訂單只送 SKU 與數量，價格、稅額、成本由 Functions 讀取資料庫計算。

## 庫存一致性

| 機制 | 說明 |
| --- | --- |
| 交易工作單元 | `functions/src/tx.ts`：讀取快取＋寫入緩衝，最後一次寫入，符合 Firestore「先讀後寫」規則；查詢結果會合併本交易尚未寫入的變更 |
| 並行安全 | Admin SDK 交易會鎖定讀取過的文件；兩筆訂單同時搶同一批貨會被序列化或重試，重試時看到庫存不足即失敗 → 不超賣（Case 3 並行測試驗證） |
| 帳本 | `invTxs` 每筆異動一筆，只新增不修改；錯誤以 `REVERSAL` 沖銷（`invTxReversals` 記錄關聯，`uniq` 防止重複沖銷） |
| 餘額 | `invLots.onHand / reserved` 只在同一交易中與帳本一起更新；`inventory.reconcile` 驗證餘額＝帳本加總、保留＝有效保留加總（庫存中心頁面顯示） |
| 不可負庫存 | Domain 在寫入前檢查 `onHand ≥ 0`、`reserved ≤ onHand`，違反即整筆交易回滾 |
| 冪等 | 訂單 idempotencyKey（`uniq` 文件）、付款固定文件 id `pay-{orderId}`、狀態轉換先檢查原狀態 |
| 唯一性 | 代碼、SKU、批次編號以 `uniq/{種類:值}` 佔位文件保證唯一 |
| 精確數字 | 重量、金額、成本以**字串**保存，decimal.js 計算，不用浮點數 |

## 安全

| 項目 | 實作 |
| --- | --- |
| 登入 | Firebase Auth（內建防暴力登入保護）；只有 `admins/{uid}` 名單內的帳號可使用後台 |
| 初始管理員 | 部署時設定參數 `BOOTSTRAP_ADMIN_EMAIL`；該 Email 的使用者第一次登入可申請成為管理員，之後即鎖定 |
| 伺服器端授權 | 每次呼叫 `api` 都檢查 `request.auth` 與管理員名單；VIEWER 角色禁止寫入 |
| 輸入驗證 | 每個操作有 Zod schema，欄位錯誤回傳到表單 |
| 上傳 | Storage 規則限制路徑、副檔名、MIME、大小，上傳後不可覆寫；Functions 再次驗證 |
| 公開資料 | 只有 `publicTraces` 中已發布的文件可匿名逐筆讀取（不可列出），且只含可公開欄位 |
| 稽核 | `auditLogs` 記錄所有寫入操作（用戶端無法寫入） |
| 金鑰 | 官網 API 金鑰只存 SHA-256 雜湊、只顯示一次；Firebase 網頁設定值依設計為公開資訊 |

## 假設與取捨

- GitHub Pages 只能放靜態檔，因此詳細頁網址使用 `?id=` 參數（例：`/orders/view/?id=…`）。
- 報表由 Functions 計算（`report.monthly` 等），口徑同原版：營收於出貨月份認列。
- 第一版資料量以單一品牌規模設計；列表頁一次讀取整個集合並在瀏覽器篩選排序，資料量大幅成長時需改為分頁查詢。
