# ATA Coffee Management System

ATA Coffee 咖啡品牌管理後台：咖啡豆與生豆採購、烘焙與曲線、杯測、手沖、研究專案、四類庫存帳本、分裝生產、商品 SKU、訂單、成本與毛利、品牌系列與 QR 履歷。

**架構：GitHub Pages（靜態網站）＋ Firebase（Auth、Firestore、Cloud Functions、Cloud Storage）**

> 舊版（Next.js 伺服器＋PostgreSQL）保留在 `postgres-v1` 分支。

## 文件

| 文件 | 內容 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架構、資料一致性、安全設計 |
| [docs/DATABASE.md](docs/DATABASE.md) | Firestore 資料模型與集合說明 |
| [docs/API.md](docs/API.md) | Cloud Functions 操作清單、未來官網 API |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | 正式部署步驟、備份與還原、已知限制 |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | 設定值與環境分離 |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | 操作手冊 |
| [docs/TEST_REPORT.md](docs/TEST_REPORT.md) | 測試報告 |
| [CHANGELOG.md](CHANGELOG.md) | 版本紀錄 |

## 本機開發（全部在 Firebase 模擬器上，不連正式環境）

需求：Node.js 20+、Java 21（Firestore 模擬器需要）。

```powershell
npm install
```

```powershell
npm install --prefix functions
```

開啟一個終端機啟動模擬器（保持執行）：

```powershell
npm run emulators
```

另一個終端機注入示範資料，再啟動網站：

```powershell
npm run seed
```

```powershell
npm run dev
```

開啟 http://localhost:3000 ，以示範帳號 `admin@ata.local` ／ `ata-demo-2026` 登入（**只存在於本機模擬器**）。
本機開發需在專案根目錄建立 `.env.local`，內容 `NEXT_PUBLIC_USE_EMULATORS=1`；`functions/.env.local` 內容 `BOOTSTRAP_ADMIN_EMAIL=admin@ata.local`。

## 常用指令

| 指令 | 說明 |
| --- | --- |
| `npm run emulators` | 建置 Functions 並啟動 Auth／Firestore／Functions／Storage 模擬器 |
| `npm run seed` | 注入示範資料（只能寫入模擬器） |
| `npm run dev` | 開發伺服器 |
| `npm test` | 單元＋業務驗收＋安全規則測試（自動啟動模擬器） |
| `npm run test:e2e` | 靜態建置＋模擬器＋Playwright 端對端測試 |
| `npm run typecheck` / `npm run lint` | 型別檢查／Lint |
| `npm run deploy` | 部署安全規則與 Cloud Functions 到正式 Firebase 專案 |

網站本身由 GitHub Actions（`.github/workflows/deploy.yml`）在推送到 `main` 且測試通過後自動部署到 GitHub Pages。
