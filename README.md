# ATA Coffee Management System

ATA Coffee 咖啡品牌管理後台：咖啡豆與生豆採購、烘焙與曲線、杯測、手沖、研究專案、四類庫存帳本、分裝生產、商品 SKU、訂單、成本與毛利、品牌系列與 QR 履歷。

> 本版本（v0.1.0）為**可在本機完整運作的後台**：真實 PostgreSQL、帳本式庫存、伺服器端登入驗證、自動化測試。**尚未部署到雲端**（需要你的雲端帳號授權，見 [DEPLOYMENT.md](docs/DEPLOYMENT.md)）。

## 文件

| 文件 | 內容 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 系統架構、Domain Service、安全設計、技術選擇與假設 |
| [docs/DATABASE.md](docs/DATABASE.md) | ERD、資料表說明、約束與帳本規則 |
| [docs/API.md](docs/API.md) | 內部 API、未來官網 API（storefront） |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | 雲端方案比較、部署步驟、備份與還原 |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | 環境變數、開發／測試／正式環境分離 |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | 操作手冊（日常流程） |
| [docs/TEST_REPORT.md](docs/TEST_REPORT.md) | 測試報告（含 10 個業務驗收案例） |
| [CHANGELOG.md](CHANGELOG.md) | 版本紀錄 |

## 技術

Next.js 15（App Router）· React 19 · TypeScript strict · Tailwind CSS 4 · shadcn 風格元件（專案內自有）· PostgreSQL 17 · Prisma 6 · Zod · React Hook Form · ECharts 6 · Vitest · Playwright

## 本機啟動（Windows / macOS / Linux）

需求：Node.js 20 以上（已驗證 v24）。**不需要 Docker**：本機資料庫使用套件內附的正式 PostgreSQL 17 執行檔。

```powershell
npm install
```

```powershell
copy .env.example .env
```

```powershell
npm run db:local
```

```powershell
npm run db:deploy
```

```powershell
npm run db:seed
```

```powershell
npm run dev
```

開啟 http://localhost:3000 ，以示範帳號 `admin@ata.local` 登入（密碼見 `prisma/seed.ts` 檔頭註解，或在 `.env` 設定 `SEED_ADMIN_PASSWORD` 後再 Seed）。

> 本機 PostgreSQL 執行檔與資料放在 `%LOCALAPPDATA%\ata-coffee\`（因 PostgreSQL 在 Windows 無法處理含中文的路徑，例如「桌面」）。停止：`npm run db:local:stop`。

## 常用指令

| 指令 | 說明 |
| --- | --- |
| `npm run dev` | 開發伺服器 |
| `npm run build` / `npm start` | 正式建置／啟動 |
| `npm run db:local` / `db:local:stop` | 啟動／停止本機 PostgreSQL |
| `npm run db:migrate` | 開發時建立新 migration（`prisma migrate dev`） |
| `npm run db:deploy` | 套用 migration（正式環境亦使用，非破壞性） |
| `npm run db:seed` | 注入示範資料（`APP_ENV=production` 時拒絕；資料庫非空時略過） |
| `npm run db:reset-dev` | 清空**本機**開發資料庫（只允許 127.0.0.1／localhost） |
| `npm run admin:create` | 建立／重設正式環境管理員 |
| `npm test` | 單元與整合測試（使用 `ata_test` 資料庫） |
| `npm run test:e2e` | Playwright E2E（需先 Seed 開發資料庫） |
| `npm run backup` | pg_dump 備份資料庫 |
| `npm run typecheck` / `npm run lint` | 型別檢查／Lint |

測試前請建立 `.env.test`（內容同 `.env.example`，但 `DATABASE_URL` 指向 `ata_test`、`APP_ENV=test`）。

## 已知限制與尚未完成清單

請見 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#已知限制與尚未完成) 與 [docs/TEST_REPORT.md](docs/TEST_REPORT.md#已知限制)。摘要：

- **尚未部署雲端**：需要你建立雲端帳號並授權（見部署文件「需要你操作的步驟」）。
- **Supabase Auth / Supabase Storage 尚未串接**：目前使用本系統自建的資料庫 Session 登入與本機檔案儲存；架構已預留 Adapter。
- **Olomo 原生曲線格式未實作**：未取得可驗證的格式規格，請先匯出 CSV 再匯入（已支援欄位對應與 Artisan `.alog`）。
- **官方 Logo／Ati／Ato 為佔位圖**：請於「系統設定 → 品牌素材」上傳正式檔案。
- 套組（禮盒）第一版只支援現貨組件；配方豆（多來源混批）Schema 已預留，第一版禁止。
