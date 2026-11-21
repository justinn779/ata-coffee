# 部署（GitHub Pages ＋ Firebase）

## 費用

- **GitHub Pages**：公開儲存庫免費。
- **Firebase Blaze（用量計費）**：Cloud Functions 必須使用 Blaze；以單一品牌的使用量，Firestore／Functions／Storage 多半落在免費額度內，但需綁定信用卡。建議在 Google Cloud 設定**預算提醒**。價格以 Firebase 官網為準。

## 一次性設定

### A. 你需要親自完成（涉及帳號與付款）
1. 到 https://console.firebase.google.com 建立專案（例：`ata-coffee`），Analytics 可不啟用。
2. 升級為 **Blaze** 方案並綁定付款方式；建議設定預算提醒。
3. **Firestore Database**：建立資料庫，正式模式，位置 `asia-east1（台灣）`。
4. **Storage**：啟用，位置同上。
5. **Authentication**：啟用「電子郵件／密碼」登入；在「使用者」新增你的管理員帳號（密碼由你自行設定）。
6. 專案設定 → 一般 → 新增「網頁應用程式」，取得 Firebase 設定值。

### B. 可由我協助執行
7. `firebase login`（瀏覽器登入你的 Google 帳號）。
8. `.firebaserc` 設定正式專案 ID，執行 `npm run deploy`（部署安全規則與 Functions；部署時輸入 `BOOTSTRAP_ADMIN_EMAIL`＝步驟 5 的 Email）。
9. GitHub 儲存庫：Settings → Pages → Source 選 **GitHub Actions**；Settings → Variables 新增 6 個 `FIREBASE_*` 變數（步驟 6 的值）。
10. Authentication → 設定 → 已授權網域：加入 `<你的帳號>.github.io`。
11. 推送到 `main`，Actions 測試通過後自動部署。
12. 開啟 `https://<帳號>.github.io/ata-coffee/`，以步驟 5 的帳號登入，按「設定為初始管理員」。

## 部署後驗證

- [ ] 可登入並成為管理員；他人帳號登入只看到「尚未授權」
- [ ] 建立咖啡豆、生豆入庫，庫存中心顯示「對帳正常」
- [ ] 上傳曲線 CSV 可預覽並匯入
- [ ] 公開履歷 `/t/?c=…` 不需登入可開啟

## 備份與還原

- **自動備份（建議）**：Firestore → 災難復原 → 啟用排程備份（每日，保留 7 天以上）或時間點復原（PITR）。
- **手動完整備份**：後台「系統設定 → 匯出與備份 → 下載完整備份」，取得全部集合的 JSON；建議每週存到離線位置。
- **還原**：Firebase Console 從排程備份還原到新資料庫，確認後切換；或用 `gcloud firestore import`。還原後於庫存中心確認「對帳正常」。
- Cloud Storage 的曲線原始檔與品牌素材可用 `gsutil rsync` 另外備份。

## 已知限制與尚未完成

| 項目 | 狀態 |
| --- | --- |
| Olomo 原生曲線格式 | 未實作（無可驗證規格）；請匯出 CSV 使用欄位對應匯入 |
| Artisan `.alog` | 依開源存檔結構實作並以樣本檔測試；建議用實機檔案再驗證 |
| 官方 Logo／Ati／Ato | 佔位圖；請在品牌素材上傳正式檔案 |
| 多角色權限 UI | 角色欄位已預留，UI 目前只有管理員 |
| 套組接單後分裝、配方豆混批 | 第一版不支援（資料結構預留） |
| 成本分攤規則 | 保存計算方式，不自動套用 |
| 大量資料 | 列表一次讀取整個集合；資料量大幅成長時需改為分頁查詢 |
| 正式稅務申報 | 不在範圍內（管理會計報表） |
