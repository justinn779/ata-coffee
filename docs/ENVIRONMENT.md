# 環境設定

## 環境分離

| 環境 | Firebase 專案 | 說明 |
| --- | --- | --- |
| 開發／測試 | `demo-ata-coffee`（模擬器專用，完全離線） | `npm run emulators`、`npm test`、`npm run test:e2e`；示範資料只能寫入模擬器（`scripts/seed-emulator.ts` 會拒絕其他目標） |
| 正式 | 你建立的 Firebase 專案 | `.firebaserc` 加入正式專案；不執行 Seed |

## 前端（建置時）

| 變數 | 說明 |
| --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` 等 6 項 | Firebase 網頁設定（公開資訊，放在 GitHub Repository variables） |
| `NEXT_PUBLIC_BASE_PATH` | GitHub Pages 子路徑，例 `/ata-coffee`（Actions 自動帶入儲存庫名稱） |
| `NEXT_PUBLIC_USE_EMULATORS` | `1` 時連線本機模擬器（`.env.local`） |

## Cloud Functions 參數

| 參數 | 說明 |
| --- | --- |
| `BOOTSTRAP_ADMIN_EMAIL` | 初始管理員 Email；部署時 Firebase CLI 會詢問，或寫在 `functions/.env.<專案ID>`（不含祕密，可提交） |

本系統沒有需要保管的伺服器祕密：Functions 以 Firebase 內建服務帳號存取資料庫；官網 API 金鑰只存雜湊。
