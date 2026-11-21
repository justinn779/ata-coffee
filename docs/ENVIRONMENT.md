# 環境設定

## 環境分離

| 環境 | 設定檔 | 資料庫 | 說明 |
| --- | --- | --- | --- |
| 開發 development | `.env` | 本機 `ata_dev` | 可 Seed 示範資料、可用 `db:reset-dev` 清空 |
| 測試 test | `.env.test` | 本機 `ata_test` | Vitest 自動載入；`tests/global-setup.ts` 檢查連線字串必須含 `ata_test` 才執行；每個測試前清空資料表 |
| 正式 production | 雲端平台環境變數 | 正式 PostgreSQL（如 Supabase） | `APP_ENV=production`：Seed 拒絕執行；`db:reset-dev` 只接受 localhost，無法對正式庫執行 |

`.env`、`.env.*`（`.env.example` 除外）已列入 `.gitignore`，**不可提交到 Git**。

## 變數

| 變數 | 必填 | 說明 |
| --- | --- | --- |
| `APP_ENV` | ✓ | `development`／`test`／`production` |
| `DATABASE_URL` | ✓ | PostgreSQL 連線字串（Prisma 格式，可含 `?schema=public`；Supabase 需 `sslmode=require`） |
| `SESSION_SECRET` | ✓ | 32 字元以上隨機字串（預留簽章用途） |
| `STORAGE_DRIVER` | ✓ | 目前僅 `local` |
| `STORAGE_LOCAL_DIR` | ✓ | 上傳檔案目錄；正式環境需為**持久化磁碟** |
| `PUBLIC_BASE_URL` |  | QR Code 使用的正式網址 |
| `SEED_ADMIN_PASSWORD` |  | 開發 Seed 的示範管理員密碼 |
| `ADMIN_EMAIL` / `ADMIN_NAME` / `ADMIN_PASSWORD` |  | `npm run admin:create` 使用（密碼建議互動輸入，不寫入檔案） |
| `INSECURE_COOKIES` |  | 設為 `1` 時在 production 也不加 Secure（僅限無 HTTPS 的內網測試，正式勿用） |
| `LOCAL_PG_PORT` / `LOCAL_PG_PASSWORD` |  | 本機 PostgreSQL 設定（預設 54329／ata_local_dev） |
| `E2E_EMAIL` / `E2E_PASSWORD` / `E2E_BASE_URL` |  | Playwright 使用 |

產生隨機字串（PowerShell）：

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```
