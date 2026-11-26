# ATA Coffee 官方商城 — 現況分析、開發計畫與決策紀錄

> 分支：`store`。這個分支**不會自動上線**（GitHub Actions 只在 `main` 推送時部署）。合併到 `main` 前需商家確認。

## 一、現況盤點（Phase 0）

| 項目 | 現況 |
| --- | --- |
| Repository | 單一 repo：`src/`（Next.js 15 App Router，靜態匯出）、`functions/src/`（Cloud Functions，esbuild 打包）、`tests/`、`scripts/`、`docs/` |
| 前端 | Next.js 15.5、React 19、Tailwind 4、react-hook-form、zod 4、lucide-react 圖示；字體 Noto Sans TC / Noto Serif TC / Inter（已在專案內） |
| 後端 | Firebase：Firestore、Auth、Cloud Functions（asia-east1）、Storage。所有寫入經 Callable `api` → `runOp` → Zod → `functions/src/domain/*` 交易 |
| 資料庫 | Firestore（無 ORM、無 SQL Migration）。十進位數存字串、decimal.js 計算；時間 ISO UTC；`uniq/*` 佔位文件做唯一性；`sequences/*` 編號 |
| 交易／併發 | `Tx` 工作單元（先讀後寫、read-your-writes），Firestore 交易對讀取文件加鎖，衝突自動重試 → 已有不超賣測試 |
| 商品模型 | `products`（商品主檔）→ `variants`（規格／SKU，含包材 BOM、套組組件、庫存政策 STOCK_ONLY / MADE_TO_ORDER / NOT_TRACKED） |
| 庫存 | `invItems`（生豆／熟豆／成品／包材）→ `invLots`（批次，onHand / reserved）→ `invTxs`（只增不改帳本）＋ `reservations`（保留） |
| 分裝 | `productionOrders`：單一熟豆批次 → 成品批次（不混豆）；接單後分裝（MADE_TO_ORDER）建立時預留熟豆 |
| 訂單 | `orders` / `orderItems` / `allocations`（成品批次分配）/ `payments` / `returns`；付款狀態、履約狀態分開；冪等鍵 |
| 成本 | 批次成本沿生豆 → 烘焙 → 分裝 → 成品傳遞；`orderItems.costSnapshot` 依實際分配批次；`costEntries` 物流／平台費 |
| 權限 | Firebase Auth；`admins/{uid}` 名單；Firestore 規則禁止所有用戶端寫入，只有管理員可讀 |
| 既有對外 API | `storefront` HTTP（伺服器對伺服器 API 金鑰）—— 商城不使用，保留相容 |
| 圖片 | Cloud Storage（`brand/` 只限管理員讀寫）；正式 Logo：`public/brand/logo.png` |
| 吉祥物 | 專案內**沒有** Ati & Ato 正式素材，只有標示「非官方圖像」的佔位元件 |
| 通知 | `notify/`：Telegram、Gmail SMTP（nodemailer），金鑰存在 `secrets` 集合（用戶端無法讀取） |
| 測試 | Vitest 整合測試（模擬器）92 項、Playwright E2E 82 項、安全規則測試；CI 全部通過才部署 |
| 部署 | `main` 推送 → GitHub Actions 測試 → GitHub Pages；Functions 手動 `firebase deploy` |
| Git | 工作區乾淨，無未提交修改 |

## 二、架構決策（ADR）

| # | 決策 | 理由 |
| --- | --- | --- |
| D1 | 商城與後台放在**同一個 Next.js 專案**，商城路由在 `/shop/`，後台維持原路徑 | 共用型別、工具與部署流程；不改動後台既有網址 |
| D2 | 新增 Callable Function **`shop`**（公開＋顧客 API），與管理員 `api` 分開；商城後台操作加在 `api` 的 `store.*` 操作 | Public / Customer / Admin 權限明確分離；顧客永遠碰不到 `api` |
| D3 | 商城**不直接讀 Firestore**；安全規則維持「只有管理員可讀」 | 前台不可能讀到成本、供應商、其他人訂單 |
| D4 | 沿用 `products` / `variants`，加商城欄位（slug、圖片、風味、商城狀態、研磨…） | 不建立第二套商品主檔 |
| D5 | 商城訂單沿用 `orders` / `orderItems` / `allocations` / `reservations`，新增 `orderStatus` 維度與商城欄位 | 共用同一套庫存與成本；後台訂單頁直接看得到商城訂單 |
| D6 | 可售量（ATP）＝ 可用成品批次（符合出貨日品質期限）＋ 可接單後分裝：**單一**熟豆批次可分裝包數（不合併零碎）且受包材限制 | 符合不混豆；共用熟豆在建立訂單時於同一交易扣保留，不會重複承諾 |
| D7 | 預購配額獨立集合 `preorderCampaigns`（cap / reserved / confirmed），不用負庫存 | 規格要求 |
| D8 | 自選禮盒＝`isBundle` 規格加 `customBundle` 設定，顧客選擇存在明細 `bundleComponents` 快照 | 沿用既有套組展開與保留邏輯，禮盒與單品共用庫存不超賣 |
| D9 | 金額：新台幣以既有十進位字串保存、decimal.js 計算，商城售價限整數元 | 沿用既有慣例；不使用浮點 |
| D10 | 優惠引擎：決定性演算法（可疊加組合 vs 每個不可疊加優惠單獨，取折扣最大；同額依優先序、ID） | 不受執行順序影響 |
| D11 | 付款狀態沿用既有值並擴充：`UNPAID`、`PENDING_CONFIRMATION`（＝REPORTED）、`UNDER_REVIEW`、`PAID`、`REJECTED`、`EXPIRED`、`REFUND_PENDING`、`PARTIALLY_REFUNDED`、`REFUNDED` | 不破壞既有資料與後台 |
| D12 | 訪客訂單：高強度隨機 Token（只存 SHA-256 雜湊、有效期限、可撤銷）＋ Email 驗證碼（雜湊、10 分鐘、5 次、速率限制） | 不依訂單編號提供內容 |
| D13 | 顧客登入：Google 用 Firebase Auth；LINE 用正式 OAuth 2.1 + PKCE + state + nonce，由 Function 驗證 id_token 後簽發 Firebase Custom Token；沒有 LINE 憑證時只在模擬器提供明確標示的 Mock | 正式環境不開放 Mock |
| D14 | 通知：交易內寫入 `notifyOutbox`（文件 id＝去重鍵），交易提交後由觸發器／排程發送，失敗重試 | Email 失敗不影響訂單；不重複寄送 |
| D15 | 物流：`LogisticsProvider` 介面，第一版 `ManualProvider`（顧客輸入官方門市查詢結果、後台人工建單與輸入物流單號） | 正式物流 API 需商家申請；不宣稱已串接 |
| D16 | 預覽：本機 Firebase 模擬器＋靜態網站（與 GitHub Pages 相同子路徑），含標示的測試資料 | 不需正式憑證、不影響正式資料 |
| D17 | Firestore 沒有 Migration 機制：新欄位一律「讀取時給預設值」，不改寫既有文件 | 零破壞；回滾只需部署舊版程式 |
| D18 | 商品網址 `/shop/p/?s={slug}`（靜態匯出無法在建置時產生動態頁） | GitHub Pages 限制；如需最佳 SEO 可改為 Firebase Hosting 預先產生頁面（已列入已知限制） |

## 三、開發階段與任務清單

- [x] Phase 0 盤點與建立 `store` 分支
- [ ] Phase 1 後端核心：商城欄位、ATP、預購、禮盒、優惠、運費、建立訂單、付款回報、逾期、取消、訪客存取、狀態歷史、Outbox
- [ ] Phase 2 前台：首頁、列表、商品、禮盒、購物車、結帳、完成、查詢、訂單、付款回報、登入、會員、靜態頁、404、維護
- [ ] Phase 3 後台：商城商品欄位、預購、優惠、付款對帳、物流、首頁內容、商城設定、電商報表
- [ ] Phase 4 Google／LINE 登入、Email、物流 Manual Provider
- [ ] Phase 5 測試（整合、E2E、各寬度畫面）、修正、回歸
- [ ] Phase 6 預覽、文件、上線檢查清單
