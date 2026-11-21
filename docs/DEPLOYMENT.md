# 部署與備份

> **目前狀態：尚未部署到雲端。** 部署需要你的雲端帳號、付款方式與授權，這些我不能代為建立或付費。下面列出方案比較、建議做法與你需要做的步驟。

## 1. 方案比較（2026-11 查詢，價格請以官方頁面為準）

本系統特性：Next.js 動態伺服器（Server Actions、API）、PostgreSQL、**上傳檔案目前存在本機磁碟（需持久化磁碟）**、單一管理員、流量很低。

| 方案 | 商業用途 | Next.js 動態功能 | 資料庫 | 檔案儲存 | 備份 | 參考月費 | 備註 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Vercel Hobby | **不允許**（僅個人非商業） | 完整 | 需外接 | 檔案系統不持久 | — | US$0 | 不可用於 ATA 正式營運 |
| Vercel Pro + Supabase Pro | 允許 | 完整 | Supabase PostgreSQL | **需先實作 Supabase Storage adapter**（目前 local 磁碟在 Serverless 不持久） | Supabase 每日備份 7 天 | 約 US$20/人 + US$25 起 | 後續擴充性最好，但月費最高 |
| Supabase Free | 可用於測試，**正式不建議** | — | 500 MB | 1 GB | **無每日備份** | US$0 | 一週低活動會暫停專案 |
| Zeabur（容器 + Volume） | 依付費方案 | 完整（Docker） | 可同平台 PostgreSQL 或 Supabase | Volume 約 US$0.20/GB·月 | 需自行設定或用 Supabase | 視方案（Dev／Pro 約 US$19） | 臺灣團隊、中文介面；方案近期調整，請確認 |
| Render（Web Service + Disk + Postgres） | 允許（付費實例） | 完整（Docker） | Render Postgres（約 US$6 起） | Disk 約 US$0.25/GB·月 | Postgres 付費方案含備份 | 約 US$13 起 | 免費 Postgres 會到期刪除，正式勿用 |
| 自有 VPS（Docker） | 允許 | 完整 | 自架或 Supabase | 本機磁碟 | 需自行排程 `npm run backup` | 約 US$5–10 | 維運責任最高 |

**建議**

1. **展示／試用（不收費）**：本機執行即可；若要給他人看，可用 Supabase Free 資料庫 + Render／Zeabur 付費最低實例的**測試環境**，並標明非正式。
2. **正式營運（建議）**：**Render 或 Zeabur 容器（使用本專案 `Dockerfile`）＋ 持久化磁碟 ＋ Supabase Pro 資料庫**（每日備份、不暫停）。估計月費約 US$35–50。不需改程式。
3. 若日後偏好 Vercel：需先完成 Supabase Storage adapter（`src/server/storage.ts` 已預留介面），並使用 Vercel Pro。

資料來源：[Vercel Hobby 方案說明](https://vercel.com/docs/plans/hobby)、[Vercel Fair Use](https://vercel.com/docs/limits/fair-use-guidelines)、[Supabase Pricing](https://supabase.com/pricing)、[Supabase 資料庫成本 FAQ](https://supabase.com/kb/faqs/platform/database-only-cost)、[Zeabur 方案](https://zeabur.com/docs/pricing/pricing-plans)、[Zeabur 方案更新](https://zeabur.com/changelogs/new-subscription-plans)、[Render Pricing](https://render.com/pricing.md)、[Render Postgres 價格](https://render.com/articles/managed-postgresql-pricing-2026)。部分數字來自第三方整理，採購前請再次確認。

## 2. 需要你操作的步驟（正式部署）

我無法代為註冊帳號、輸入付款資料或取得密鑰。請依序完成，完成後告訴我，我再接手設定與驗證：

1. **建立 Supabase 專案**（建議 Pro、區域選 Tokyo 或 Singapore）→ 在 Project Settings → Database 取得連線字串（Session pooler，port 5432）。
2. **建立 Render 或 Zeabur 帳號**，選擇付費方案（我不會代為購買）。
3. 將本專案推送到你的 **GitHub 私人儲存庫**（我可以協助 `git init`、commit，需你授權 push）。
4. 在平台建立 Web Service（Docker，使用 `Dockerfile`），掛載持久化磁碟到 `/app/storage`。
5. 在平台的環境變數設定（**不要貼到聊天中**）：`APP_ENV=production`、`DATABASE_URL`、`SESSION_SECRET`、`STORAGE_DRIVER=local`、`STORAGE_LOCAL_DIR=/app/storage`、`PUBLIC_BASE_URL`。
6. 首次部署完成後，在平台的 Shell 執行：`npm run admin:create`（互動輸入密碼）。**不要執行 `db:seed`**（正式環境會拒絕）。
7. 綁定自訂網域並確認 HTTPS。

容器啟動時會自動執行 `prisma migrate deploy`（只套用新 migration，不會刪資料）。

## 3. 部署後驗證清單

- [ ] `GET /api/health` 回傳 `{"status":"ok","db":"ok"}`
- [ ] 可登入、各模組頁面開啟正常
- [ ] 建立一筆生豆採購 → 庫存中心顯示「對帳正常」
- [ ] 上傳曲線 CSV 後重新部署，檔案仍可下載（確認磁碟持久化）
- [ ] Cookie 具 `Secure`、`HttpOnly`
- [ ] 每日備份已啟用（Supabase Pro）或已排程 `npm run backup`

## 4. 備份與還原

**資料庫**

- Supabase Pro：每日自動備份（保留 7 天）；可於 Dashboard 還原。
- 自行備份（任何環境）：`npm run backup` → `backups/ata-YYYYMMDD-HHmm.dump`（pg_dump 自訂格式）。建議每日排程並複製到異地（例如雲端硬碟）。
- 還原（**先還原到測試資料庫驗證**）：

```powershell
pg_restore --clean --if-exists --no-owner -d "<目標資料庫連線字串>" backups\ata-20261121-0300.dump
```

還原後執行 `npm run db:deploy` 確保 migration 為最新，並到庫存中心確認「對帳正常」。

**上傳檔案**：`STORAGE_LOCAL_DIR` 目錄（曲線原始檔、品牌素材）需一併備份。

**CSV 匯出**（系統設定 → 匯入匯出）適合給 Excel 分析，**不能取代資料庫備份**。

## 已知限制與尚未完成

| 項目 | 狀態 |
| --- | --- |
| 雲端正式部署 | 未完成：需你建立帳號與授權（見上方步驟） |
| Supabase Auth | 未串接；使用自建資料庫 Session（安全措施見 ARCHITECTURE.md） |
| Supabase Storage | 未實作 adapter；目前需持久化磁碟 |
| Olomo 原生曲線格式 | 未實作（無可驗證規格）；請匯出 CSV 使用欄位對應匯入 |
| Artisan `.alog` | 依 Artisan 開源存檔結構實作並以樣本檔測試；建議用你實際的 .alog 檔驗證 |
| 官方 Logo／Ati／Ato | 佔位圖；請上傳正式素材 |
| 多使用者角色權限 | Schema 已預留 role；目前 UI 只有單一管理員，未提供使用者管理頁 |
| 套組接單後分裝 | 第一版套組只支援現貨組件 |
| 配方豆（混批） | Schema 預留（ProductionConsumption 可多來源），第一版禁止 |
| 成本分攤規則 | 保存計算方式，第一版不自動套用，需手動填入烘焙／分裝成本 |
| 商品圖片上傳 | 品牌素材可上傳；商品／咖啡豆個別圖片欄位已預留，UI 尚未提供 |
| 正式稅務申報 | 不在範圍內（管理會計報表） |
