# 版本紀錄

## v0.3.0 — 2026-11-22

### 新增
- 登入頁「忘記密碼」：寄送重設密碼信（不透露帳號是否存在）
- Google 帳號：在「系統設定 → 個人帳號」綁定後可用 Google 登入；未綁定的 Google 帳號無法進入後台
- 杯測、手沖紀錄可修改與刪除；扣庫存數量變動或刪除時，自動沖銷原交易再重扣（帳本只新增不修改）
- 研究專案可刪除；實驗版本可修改與刪除
- 出貨前修改訂單（限未確認付款）：同一交易內釋放原保留、取消未完成的接單後分裝單、依新內容重新保留；庫存不足時整筆不生效；原品項沿用下單時單價
- Firebase App Check（reCAPTCHA Enterprise）：Cloud Functions 只接受來自本網站的呼叫

### 更新
- Next.js 15.5.29、React 19.1.10（安全性修補）、Zod 4、Vitest 5、Playwright 1.65
- GitHub Actions 升級至最新主版本；新增 Dependabot（每週檢查套件、每月檢查 Actions）

## v0.2.0 — 2026-11-21

### 變更
- 架構改為 GitHub Pages（Next.js 靜態匯出）＋ Firebase（Auth、Firestore、Cloud Functions、Cloud Storage）
- 業務邏輯移至 Cloud Functions，Firestore 交易工作單元確保不超賣、帳本一致
- Firestore／Storage 安全規則：用戶端只能讀取，所有寫入經 Functions
- 曲線原始檔與品牌素材改存 Cloud Storage；CSV／JSON 匯出改在瀏覽器產生
- 新增安全規則測試；E2E 改為靜態站＋模擬器；GitHub Actions 測試通過後自動部署
- PostgreSQL 版本保留於 postgres-v1 分支

## v0.1.0 — 2026-11-21

首個可在本機完整運作的版本。

### 新增
- 品牌設計系統（Ivory／Cream／Coffee Brown／Espresso／Sage／Muted Gold，亮暗色模式，繁體中文字型自行託管）、響應式後台（桌面側欄、可收合、手機抽屜與卡片列表）
- 登入（資料庫 Session、bcrypt、速率限制）、稽核紀錄、安全標頭、CSRF 防護
- 咖啡豆主檔、生豆採購（固定每克成本、成本更正）
- 烘焙中心：批次、事件、失重率／DTR／各期時間、複製上一批、CSV（欄位對應）與 Artisan .alog 曲線匯入、原始檔保存、BT／ET／RoR 圖表與疊圖比較
- 杯測實驗室：自訂評分模板、雷達圖、養豆天數比較、評分趨勢、同批／跨批比較
- 手沖實驗室：分段注水、複製參數、配方版本、推薦、比較
- 研究專案：假設／變因、實驗版本、基準組、統計與主觀觀察分開
- 庫存中心：四類庫存帳本（不可修改，沖銷更正）、保留、對帳、手動異動、包材入庫、預警
- 分裝生產：預先分裝與接單後分裝、熟豆預留、包材 BOM、成品成本、品質保留
- 商品與 SKU：Product／Variant 分離、套組 BOM、限定商品、庫存政策
- 訂單：付款與履約狀態分離、保留／出貨／取消／退貨待檢／退款、批次分配、成本快照、批次追溯
- 成本與報表：銷貨毛利、訂單貢獻利益、營業淨利（管理用）、SKU 表現、損耗統計、期間費用、成本分攤規則
- 品牌系列與 QR Code 公開履歷
- 系統設定、CSV 匯出／匯入、未來官網 Storefront API（API 金鑰）
- 測試：業務驗收 Case 1–10 等整合測試、單元測試、Playwright E2E；Dockerfile、備份腳本、文件
