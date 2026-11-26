# ATA Coffee 官方商城 — 交付文件

相關文件：[現況分析、開發計畫與決策紀錄](PLAN.md)｜[外部服務評估與法規重點](EXTERNAL_SERVICES.md)

## 1. 系統架構

```
顧客瀏覽器 ── /shop/*（同一個 Next.js 靜態網站）
   │  shopCall("shop", op)  ← Callable Function `shop`（公開＋顧客 API，速率限制）
   │  Firebase Auth（Google／LINE Custom Token；可不登入）
管理員瀏覽器 ── 後台 /store/*、/orders/* …
   │  callOp("api", op)     ← Callable Function `api`（只限 admins 名單）
   ▼
Cloud Functions（asia-east1）
   ├ functions/src/shop/catalog.ts   型錄、可售量（ATP）
   ├ functions/src/shop/pricing.ts   計價、優惠引擎、運費、出貨日
   ├ functions/src/shop/orders.ts    下單保留、付款回報、取消、逾期、預購、物流、訪客存取
   ├ functions/src/shop/outbox.ts    通知寄件匣（Email 品牌版型、重試、去重）
   ├ functions/src/shop/line.ts      LINE Login（PKCE＋state＋nonce）
   ├ functions/src/shop/admin.ts     商城後台操作（併入 api）
   └ functions/src/domain/*          既有：庫存帳本、保留、分裝、訂單、成本（共用，不另建庫存）
排程：shopTasks（每 10 分鐘：逾期取消、付款提醒、重寄通知）；觸發器：outboxSend
Firestore：安全規則不變（瀏覽器不可寫入；只有管理員可讀）→ 顧客只能透過 shop API 取得自己的資料
```

**權限分離**：Public（型錄、首頁、報價、下單、訂單連結）／Customer（會員資料、歷史訂單、購物車）／Admin（`api`，商城後台）。商城 API 沒有任何後台操作（測試驗證）。前台輸出不含成本、供應商、批次、SKU（測試驗證）。

## 2. 資料模型（Firestore，沿用既有集合並擴充）

| 邏輯實體 | 實作 |
| --- | --- |
| Product／ProductVariant(SKU) | 沿用 `products`、`variants`；新增 `products.store`（狀態、代稱、圖片、風味、收合資訊、研磨、排序）、`variants.store`（顯示、排序、`customBundle`） |
| ProductImage／Category／MediaAsset | `products.store.images`；分類由商品類別推導（咖啡豆／濾掛／禮盒）；圖片存 Storage `store/`（公開讀、管理員上傳） |
| BundleDefinition／BundleComponent | 固定禮盒＝既有套組 `bundleComponents`＋禮盒包材 `materials`；自選禮盒＝`variants.store.customBundle` |
| InventoryReservation／Movement／BatchAllocation | 沿用 `reservations`、`invTxs`、`allocations`（禮盒包材也以分配保留，出貨扣帳） |
| PreorderCampaign／PreorderReservation | `preorderCampaigns`（cap／reservedQty／confirmedQty／shipDate／originalShipDate）；明細 `orderItems.preorderState`（RESERVED／CONFIRMED／RELEASED） |
| Customer／CustomerIdentity／SavedPickupStore | `shopCustomers/{uid}`（含 savedStores）、`customerIdentities/{provider:sub}` |
| Cart／CartItem | 訪客：瀏覽器 localStorage；會員：`shopCarts/{uid}` |
| Order／OrderItem／OrderItemComponent | 沿用 `orders`（`channel: "STORE"`＋`store` 快照：門市、收款帳戶、付款期限、優惠、出貨日）、`orderItems`（研磨、禮盒內容、預購、圖片、名稱價格快照） |
| OrderStatusHistory | `orderEvents`（付款、履約、訂單狀態每次變動一筆） |
| PaymentReport／PaymentTransaction | `paymentReports`（末五碼字串）；`payments`（沿用，`pay-{orderId}` 冪等） |
| Shipment／ShipmentItem | `orders.shipment`＋已出貨 `allocations` |
| Promotion／Coupon／PromotionRedemption | `promotions`（折扣碼＝code 欄位）、`promotionRedemptions` |
| ContentSection | `storeContent`（draft／published） |
| StoreSetting | `settings/store` |
| NotificationOutbox | `notifyOutbox` |
| GuestAccessToken | `orderAccess/{sha256(token)}`、`orderCodes`（驗證碼雜湊） |
| AuditLog | 沿用 `auditLogs` |

**Migration**：Firestore 無 Schema；所有新欄位「讀取時給預設值」，**不改寫任何既有文件**。既有資料零修改、可直接回滾（部署舊版程式即可）。新增複合索引：`notifyOutbox(status, nextAttemptAt)`；`rateLimits.expiresAt` TTL。

## 3. 狀態

- 付款：`UNPAID` → `PENDING_CONFIRMATION`（＝REPORTED）→ `UNDER_REVIEW` → `PAID`；`REJECTED`（可重新回報）、`EXPIRED`、`REFUND_PENDING`、`PARTIALLY_REFUNDED`、`REFUNDED`
- 履約：`PENDING`／`AWAITING_PACKAGING`（待生產、預購）／`READY_TO_SHIP` → `SHIPPED` → `ARRIVED` → `PICKED_UP`；`LOGISTICS_ISSUE`、`RETURNED_UNCLAIMED`、`CANCELLED`、`RETURN_PROCESSING`（物流轉換有白名單，非法轉換拒絕）
- 訂單：由付款＋履約推導（PENDING／PROCESSING／COMPLETED／CANCELLED），不會與另外兩個維度不一致
- 逾期：排程只取消「仍是 UNPAID」的訂單（交易內重新確認）；已回報的只標記 `needsReview`，等人工確認

## 4. 商城 API（Callable `shop`，`{ op, input }`）

| op | 權限 | 說明 |
| --- | --- | --- |
| `store.boot` / `home` / `products.list` / `product.get` / `page.get` | 公開 | 設定、首頁、型錄、內容頁 |
| `cart.quote` | 公開 | 後端重新計價（優惠、運費、出貨日、可買數量、簽章） |
| `order.create` | 公開（10 次／分） | 需 `signature`（報價簽章）與 `idempotencyKey`；回傳訂單連結權杖 |
| `order.get` / `order.reportPayment` / `order.cancel` | 權杖或本人會員 | 物件層級授權 |
| `lookup.request` / `lookup.verify` | 公開（5／10 次／分） | Email 驗證碼查詢、會員歸戶 |
| `account.*` / `cart.get` / `cart.save` / `auth.lineLinkStart` | 會員 | |
| `auth.redeemTicket` | 公開 | LINE 一次性登入票換 Custom Token |
| `dev.mockLogin` | 只在模擬器 | 正式環境回覆 NOT_CONFIGURED |

錯誤格式：`HttpsError.details = { code, data }`，code：`INSUFFICIENT_STOCK`、`PRICE_CHANGED`（data.quote 為新報價）、`PREORDER_SOLD_OUT`、`PROMOTION_INVALID`、`PAYMENT_EXPIRED`、`ORDER_STATE_CONFLICT`、`INVALID_PICKUP_STORE`、`UNAUTHORIZED_ORDER_ACCESS`、`PRODUCT_UNAVAILABLE`、`INVALID_BUNDLE`、`STORE_CLOSED`、`RATE_LIMITED`、`CODE_INVALID`、`LOGIN_REQUIRED`、`NOT_CONFIGURED`。

後台操作（`api`）：`store.settings.save`、`store.product.save`、`store.variant.save`、`store.preorder.save|delay|allocate`、`store.promotion.save`、`store.content.save|publish|delete|preview`、`store.payment.reject|status`、`store.shipment`、`store.access.revoke`、`store.outbox.retry`、`store.report`；付款確認、出貨、退款沿用 `order.confirmPayment`、`order.ship`、`order.refund`。

## 5. Design System（`src/app/shop/shop.css`）

- 色彩：主背景 `#FCFAF6`、次背景 `#F0EBE2`、輔助 `#C6B39D`、品牌主色 `#594235`、主要文字 `#24211E`（對比 ≈ 15:1）、次要文字 `#6E6258`（≈ 5.9:1）
- 字體：Noto Serif TC（標題）、Noto Sans TC（內文）、Inter（數字，等寬數字）
- 間距：4／8／12／16／24／32／48／64／96；圓角 4px（`--s-radius`）；無陰影、無漸層
- 元件：`.s-btn`（48px 高、品牌色）、`.s-btn-line`、`.s-btn-light`、`.s-icon-btn`（44×44）、`.s-input`（16px 字防 iOS 放大）、`.s-chip`；商品圖 4:5；線條圖示（lucide，1.5 線寬）
- 動畫：淡入、抽屜上滑；`prefers-reduced-motion` 全部關閉
- Logo：使用正式 `public/brand/logo.png`；吉祥物 Ati & Ato：**專案沒有正式素材**，`Mascot` 元件顯示標明「角色素材待替換」的佔位圖（放置 `public/brand/mascot/ati.png`、`ato.png` 並把 `OFFICIAL_MASCOT` 設為 true 即可替換），只用於空購物袋、訂單成立、售完、維護、404

## 6. 本機預覽（可實際操作）

```powershell
npm run build:emulator
```
```powershell
npm run preview:store
```
啟動 Firebase 模擬器＋示範資料＋靜態網站（約 1–2 分鐘）。

- 前台：http://127.0.0.1:4173/ata-coffee/shop/
- 後台：http://127.0.0.1:4173/ata-coffee/store/ （帳號密碼見 `scripts/seed-emulator.ts` 開頭，僅存在本機模擬器）
- 測試會員：前台「登入」頁下方「測試會員 A／B」（只在模擬器出現）
- 測試優惠碼：`WELCOME100`（滿 800 折 100、每人一次）、`ATA10`（9 折不可併用，最多折 300）；自動：濾掛任 2 件折 30
- 示範資料：現貨（耶加雪菲、哥倫比亞、濾掛）、預購（肯亞）、售完（瓜地馬拉）、即將推出（宏都拉斯）、固定禮盒、濾掛 5 入組、自選三入禮盒、未付款／待對帳／已付款含預購／已出貨訂單
- 模擬器寄出的 Email 寫在 Firestore `devMailbox`（不會真的寄出）；LINE 登入在模擬器是標示「測試環境」的模擬授權頁

## 7. 測試指令

```powershell
npm test
```
```powershell
npm run test:e2e
```
```powershell
npm run typecheck
```

### 實際測試結果（2026-11-26，本機模擬器）

- 整合測試（Vitest）：**118 項全部通過**（既有 92 項回歸＋商城 26 項：不超賣併發、不混豆、不重複扣熟豆、禮盒共用庫存、預購配額／延期／分配、優惠疊加與次數併發、免運邊界、末五碼前導零、逾期與付款併發、物流狀態、驗證碼限制、權杖撤銷、會員隔離、購物車合併）
- E2E（Playwright，Edge）：完整執行 98 項，96 通過、2 項商城測試失敗（登出導向、提示文字斷言）；修正後商城 E2E 17 項重跑**全數通過**；既有後台 E2E 全數通過
- 版面：375／390／768／1280／1440px 首頁、列表、商品、禮盒、購物袋、查詢、內容頁皆無水平溢出（E2E 驗證）；另以瀏覽器實際操作手機版購買流程與後台對帳

## 8. 部署與回滾（需商家核准後才執行）

1. 填好「上線前必備資料」（第 10 節），在後台「商城設定」取消示範標記。
2. Functions、規則、索引：`npm run deploy`（會部署 `shop`、`shopTasks`、`outboxSend`、`lineAuth` 與更新後的 Storage 規則、索引）。
3. 網站：把 `store` 分支合併到 `main` → GitHub Actions 測試通過後自動部署 GitHub Pages。
4. 回滾：GitHub 還原合併的 commit（網站自動重新部署）；Functions 用 `git checkout <舊版> && npm run deploy`。資料不需回滾（新功能只新增集合與欄位）。上線前先用 Firestore 匯出備份：`gcloud firestore export gs://<bucket>/backup-YYYYMMDD`。

## 9. 環境變數（不進 Git）

| 位置 | 變數 | 說明 |
| --- | --- | --- |
| `functions/.env.ata-coffee` | `LINE_CHANNEL_ID`、`LINE_CHANNEL_SECRET` | LINE Login（未設定時正式環境不提供 LINE 登入） |
| 同上 | `SITE_URL` | 信件中的商城網址（預設 https://justinn779.github.io/ata-coffee） |
| 同上 | `ENFORCE_APP_CHECK=true` | 正式環境只接受本網站呼叫（既有） |
| GitHub Variables | `FIREBASE_*` | 網頁設定（既有，公開資訊） |
| 後台「系統設定 → 通知」 | Gmail 寄件信箱與應用程式密碼 | 存在 `secrets`，瀏覽器無法讀取（既有） |

## 10. 尚待商家提供（上線阻擋事項）

1. 正式收款銀行、代碼、帳號、戶名（後台「商城設定」）
2. 正式運費與免運門檻
3. 業者名稱、統一編號、營業地址、聯絡電話、**食品業者登錄字號**
4. 購物須知、退換貨（是否適用七日解除權例外需依法確認並事先告知）、隱私權政策、服務條款的正式內容
5. 商品實拍圖、各商品食品標示（內容物、淨重、產地、有效日期、保存方式）
6. Ati & Ato 正式角色素材
7. LINE Login channel（Channel ID／Secret）
8. 物流：是否申請綠界物流（建議出貨量穩定後），或維持人工寄件
9. 正式網域（目前為 GitHub Pages 子路徑；若要更好的 SEO 與自訂網域需設定 DNS）
10. 正式寄件信箱（Gmail 應用程式密碼或交易型 Email 服務）

## 11. 功能完成狀態

| 功能 | 狀態 |
| --- | --- |
| 型錄、商品頁、可售量（成品＋單一批次接單後分裝＋包材＋賞味期限） | 已實作且通過測試 |
| 購物車（訪客持久化、會員同步、登入合併、研磨／禮盒內容分開） | 已實作且通過測試 |
| 結帳、後端重新計價、價格變動確認、重複送出防護 | 已實作且通過測試 |
| 不超賣（併發）、不混豆、不重複扣熟豆、禮盒共用庫存 | 已實作且通過測試 |
| 預購（配額、額滿、付款轉確認、延期通知保留原日期、到貨分配合併出貨） | 已實作且通過測試 |
| 優惠（折扣碼、金額、百分比、滿額、免運、組合、可否併用、次數併發） | 已實作且通過測試 |
| 銀行轉帳、末五碼回報、人工對帳、退回、逾期取消、待退款／退款紀錄 | 已實作且通過測試 |
| 訪客訂單連結、Email 驗證碼（期限、錯誤次數、速率限制）、撤銷 | 已實作且通過測試 |
| 會員中心、歷史訂單、常用門市、訂單歸戶 | 已實作且通過測試（模擬器測試會員） |
| 物流（人工：門市店號、物流單號、到店／取貨／異常／未取退回） | 已實作且通過測試（人工流程） |
| 首頁內容管理（草稿、預覽、發布、排程、自動隱藏） | 已實作且通過測試 |
| 商城後台（總覽、對帳、商城商品、預購、優惠、內容、設定、報表、訂單商城區塊） | 已實作，E2E 驗證主要頁面 |
| Email 通知（10 種事件、品牌版型、重試、去重、交易後寄出） | 已實作；寄送以測試管道與模擬器信箱驗證，**正式寄送未驗證** |
| Google 登入 | 已實作（沿用 Firebase Auth）；**正式環境未驗證** |
| LINE 登入 | 已實作；**僅 Mock 測試**，尚待 LINE channel 正式啟用 |
| 綠界等物流 API、電子地圖選店 | **尚未實作**（已建立介面與評估） |
| LINE 通知 | **尚未實作**（保留介面） |
| 商品網址預先產生、商品 sitemap | **限制**：靜態匯出下商品頁為 `/shop/p/?s=` 並由瀏覽器載入資料 |
| 效能（LCP／INP／CLS） | 前台 JS 由 310 KB 降至約 162 KB（首次載入）；**正式環境實測未進行**（需上線網址） |

## 12. 已知限制

- GitHub Pages 為靜態網站：商品頁內容由瀏覽器載入，搜尋引擎可讀取但不如伺服器預先產生；Open Graph 分享圖為全站共用。改用 Firebase Hosting＋預先產生可改善。
- 門市資料來自顧客填寫官方查詢結果（標示「人工確認」），未與超商系統驗證。
- 可售量顯示為各規格各自的上限；共用熟豆的規格以實際下單時的交易保留為準（不會超賣，但畫面上可能顯示可買、送出時才提示不足）。
- 報表依下單日期統計；退款以實際退款金額扣一次。
- 列表頁一次載入全部商品（品牌規模足夠；商品數百件以上需分頁）。
