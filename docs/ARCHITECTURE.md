# 系統架構

## 1. 總覽

採用 **模組化單體（Modular Monolith）**：單一 Next.js 應用，按業務 Domain 分離商業邏輯。

```
瀏覽器（管理後台 UI，React Server Components + 少量 Client Components）
   │  Server Actions（同源、Next.js 內建 Origin 檢查）／Route Handlers
   ▼
src/server/action.ts         ← 每個寫入動作：requireActor()（伺服器端驗證 Session）→ Zod 驗證 → Domain → 統一錯誤
   ▼
src/server/domain/*          ← 業務規則（唯一可以改變庫存、訂單、成本的地方）
   │  inventory.ts   庫存帳本、保留、沖銷、對帳（核心）
   │  green.ts       生豆採購入庫、成本更正
   │  roasting.ts    烘焙批次（扣生豆、產熟豆、DTR／失重率、成本）
   │  production.ts  分裝生產（預留熟豆、扣包材、產成品、履歷）
   │  orders.ts      訂單、付款、出貨、取消、退貨、退款
   │  allocation.ts  訂單批次分配、履約狀態
   │  lab.ts         杯測、手沖、配方版本
   │  reports.ts     管理會計報表
   │  traceability.ts 全流程追溯、公開履歷
   │  settings.ts / sequence.ts / audit.ts
   ▼
Prisma 6 → PostgreSQL 17（CHECK constraint、帳本不可變 trigger、列鎖）
```

**頁面不直接操作庫存資料表**：所有庫存異動只能經由 `inventory.ts` 的 `post / reserve / releaseReservation / consumeReservation`。前台（未來官網）只能透過 `/api/storefront/v1/*` 呼叫同一個 `createOrder`。

日後若改接 Java Spring Boot：資料結構（Prisma migration SQL）與業務規則（本文件、DATABASE.md、測試案例）皆與 UI 無關，可直接作為 API 規格移植。

## 2. 庫存一致性設計

| 機制 | 說明 |
| --- | --- |
| 帳本 | `InventoryTransaction` 每筆異動一列，含唯一交易 ID、groupId、類型、正負數量、單位、單位成本、結餘、來源、操作者、時間 |
| 不可變 | DB trigger `inventory_tx_immutable` 阻擋 UPDATE／DELETE；錯誤以 `REVERSAL` 沖銷交易更正（`reversesId` unique，防止重複沖銷） |
| 餘額快取 | `InventoryLot.onHand / reserved` 只能在同一 DB 交易中與帳本一起更新；`reconcile()` 驗證與帳本加總一致（庫存中心頁面顯示對帳結果） |
| 不可負庫存 | DB CHECK：`onHand ≥ 0`、`reserved ≥ 0`、`reserved ≤ onHand`、`balanceAfter ≥ 0` |
| 並行安全 | 所有異動先 `SELECT … FOR UPDATE` 鎖定相關批次（依 id 排序避免死結）；訂單鎖定該 SKU 所有成品批次後才計算可售量 → 不超賣 |
| 冪等 | 訂單 `idempotencyKey`、付款 `idempotencyKey`、狀態轉換使用條件式 `updateMany(where: 原狀態)`、保留使用 `status = ACTIVE` 條件轉換 |
| 可售量 | 一律由批次計算：Σ(onHand − reserved)，只計 `AVAILABLE` 批次；退貨待檢（QUARANTINE）、品質保留（HOLD）不可售 |
| 套組 | 不另存庫存；下單時直接保留組件成品 → 不會與單品重複承諾 |

## 3. 成本設計

- 生豆批次入庫時固定每克成本：`(採購重量kg × 單價 + 運費 + 其他) ÷ 實際入庫重量`。
- 熟豆每克成本：`(投入生豆 × 生豆單位成本 + 烘焙能源／人工等) ÷ 出爐重量`（估計／實際分開標示，保存計算說明）。
- 成品每件成本：`(熟豆耗用 + 分裝損耗) × 熟豆單位成本 + 包材 FIFO 成本 + 包裝人工) ÷ 實際件數`。
- 訂單：明細保存單價、名稱、稅額快照；批次分配保存單位成本快照 → 歷史訂單不受日後價格或成本更正影響。
- 生豆成本更正（`correctGreenCost`）只影響該批剩餘庫存之後續交易，並寫入稽核紀錄。

報表口徑（見 `reports.ts` 檔頭）：銷貨毛利、訂單貢獻利益、營業淨利（管理用）三者分開；營收於出貨月份認列。**非正式稅務申報系統**。

## 4. 安全設計

| 項目 | 實作 |
| --- | --- |
| 登入 | bcrypt（cost 12）密碼雜湊；資料庫 Session，Cookie 只存隨機 token，DB 只存 SHA-256；HttpOnly、SameSite=Lax、正式環境 Secure；7 天到期 |
| 伺服器端驗證 | `(app)/layout.tsx` 的 `requireUser()`；每個 Server Action 經 `action()` 包裝呼叫 `requireActor()`；Route Handler 各自驗證；Middleware 只是第一道導向 |
| CSRF | Server Actions 由 Next.js 檢查 Origin；Middleware 拒絕跨站的非 GET 請求；Cookie SameSite=Lax |
| 速率限制 | 登入：同 IP 15 分鐘 20 次、同帳號 8 次；Storefront API：每金鑰每分鐘 60 次（DB 實作，多執行個體可用） |
| 輸入驗證 | 所有 Action 與 API 以 Zod 驗證；價格、成本一律由伺服器讀取 |
| 上傳 | 副檔名、MIME、大小、檔頭 magic bytes 驗證；檔名改為 UUID；只能經需登入的 `/api/files` 讀取 |
| 祕密 | 皆在環境變數；API 金鑰只存雜湊、只顯示一次；前端不含任何金鑰 |
| 稽核 | `AuditLog`（不可修改 trigger）記錄登入、建立、狀態轉換、成本更正、匯出／匯入 |
| 角色 | `User.role`（ADMIN／STAFF／VIEWER）已預留；VIEWER 無法執行寫入 Action |
| 標頭 | X-Frame-Options DENY、nosniff、Referrer-Policy、Permissions-Policy；不輸出 X-Powered-By |
| `"use server"` 檔案 | 只匯出經 `action()` 或自行驗證的函式（每個匯出都是公開端點）；選項查詢放在 `src/server/options.ts`（server-only） |

## 5. 技術選擇與假設（需求中未指定之處）

| 決策 | 理由 |
| --- | --- |
| Next.js 15.5 + React 19.1 | 目前穩定版；未採用尚屬早期的大版本 |
| Prisma 6.19 | Prisma npm `latest` 標籤為 8.0 RC，未採用；6.x 為成熟穩定版 |
| 自建 Session 而非 Supabase Auth | 單一管理員、可在本機完整運作與測試；不需雲端帳號即可驗收。Supabase Auth 可在部署時改接（User 表保留） |
| 本機 PostgreSQL 用 embedded-postgres 套件的執行檔 | 此電腦 Docker 引擎未啟動；使用正式 PostgreSQL 17 而非記憶體模擬 |
| shadcn 風格元件自建於 `src/components` | shadcn/ui 本質是複製到專案的元件；為減少相依並統一品牌樣式，自行實作 Button／Card／Dialog（原生 `<dialog>`）等 |
| 字型 @fontsource 自行託管 | 開發環境無法連線 Google Fonts；自行託管也避免正式環境的外部依賴 |
| 金額／重量 | DB `Decimal`，計算使用 decimal.js（40 位精度、四捨五入），不以 JS 浮點數作最終計算 |
| 時間 | DB `timestamptz`（UTC）；顯示與「烘後天數」以 Asia/Taipei 計算；純日期欄位使用 `@db.Date` |
| 編號 | `{前綴}-{YYYYMMDD}-{序號}`，以 `DocumentSequence` 原子遞增 |
| 營收認列 | 出貨時認列（管理報表口徑），可依需要調整 |
| 曲線 RoR | 檔案未提供 RoR 時，以實際 BT 資料計算（30 秒視窗），並標示「由 BT 計算」 |

## 6. 目錄結構

```
prisma/            schema.prisma、migrations/、seed.ts
scripts/           local-db.mjs、reset-dev.mjs、create-admin.ts、backup.mjs
src/app/(app)/     各管理模組頁面與 Server Actions（需登入）
src/app/login      登入
src/app/t/[code]   公開 QR 履歷（不需登入）
src/app/api/       health、files、export、import、storefront/v1
src/components/    UI 元件（設計系統）
src/lib/           db、decimal、time、zod、labels、errors
src/server/        auth、action、storage、options、domain/*、curves/*
tests/             unit、integration（業務驗收）、e2e、fixtures
docs/              文件
```
