# 資料模型（Cloud Firestore）

- 文件 id：UUID（部分為固定 id，例如庫存品項 `coffee-green-{coffeeId}`、付款 `pay-{orderId}`）
- 十進位數（重量 g、金額 TWD、單位成本）一律**字串**；時間為 ISO 8601 UTC 字串；日期為 `YYYY-MM-DD`
- 常用欄位以**反正規化**方式保存（例：烘焙批次存 `coffeeName`），減少前端查詢
- 集合名稱定義於 `functions/src/types.ts`

## 集合

| 集合 | 內容 |
| --- | --- |
| `admins` | 管理員名單（文件 id = Auth UID）、角色 |
| `auditLogs` | 稽核紀錄 |
| `settings` | `tax`、`order`、`inventory` 系統預設 |
| `sequences` | 人類可讀編號計數器 |
| `uniq` | 唯一性與冪等佔位（代碼、SKU、批次編號、訂單冪等鍵、曲線檔雜湊、首位管理員） |
| `suppliers`、`coffees` | 供應商、咖啡豆主檔（含養豆與賞味預設） |
| `greenPurchases`、`greenLots` | 生豆採購單、生豆批次（入庫時固定每克成本） |
| `roasters`、`roastBatches` | 烘豆機、烘焙批次（事件內嵌於 `events`） |
| `roastCurves` ＋ `roastCurves/{id}/chunks` | 曲線中繼資料（原始檔路徑、SHA-256、欄位對應）、時序點分塊 |
| `flavorTags`、`cuppingTemplates`、`cuppingSessions` | 風味詞彙、自訂評分模板、杯測（分數與標籤內嵌） |
| `equipment`、`brewRecipes`、`brewSessions` | 器材、配方（`rootId`＋`version`）、手沖（注水段落內嵌） |
| `researchProjects` | 研究專案（實驗版本內嵌） |
| `locations`、`materials` | 儲位、包材 |
| `invItems`、`invLots`、`invTxs`、`invTxReversals`、`reservations` | 庫存品項（GREEN／ROASTED／FINISHED／MATERIAL）、批次餘額、帳本、沖銷關聯、保留 |
| `productionOrders`、`packagingBatches` | 分裝生產單（耗用明細內嵌）、包裝批次 |
| `brandSeries`、`products`、`variants` | 品牌系列、商品、SKU（包材 BOM 與套組組件內嵌） |
| `customers`、`orders`、`orderItems`、`allocations`、`payments`、`returns` | 顧客、訂單（出貨資訊內嵌）、明細（價格與成本快照）、批次分配、付款／退款、退貨（明細內嵌） |
| `costEntries`、`costRules` | 成本紀錄（估計／實際、計算說明）、分攤規則 |
| `traces`、`publicTraces` | 內部履歷對照、公開履歷（僅可公開欄位） |
| `brandAssets`、`apiKeys` | 品牌素材、官網 API 金鑰（只存雜湊） |

## 追溯路徑

`orders → orderItems → allocations → invLots(成品) → packagingBatches → productionOrders → invLots(熟豆) → roastBatches → greenLots → greenPurchases`

## 庫存異動類型

入庫、烘焙領料、烘焙產出、杯測耗用、試喝耗用、樣品贈送、分裝耗用、分裝損耗、分裝產出、包材耗用、報廢、盤點調整、出貨扣帳、退貨待檢、退貨轉出待檢區／重新入庫、沖銷。訂單保留／取消保留記錄於 `reservations`（ACTIVE → CONSUMED／RELEASED，不刪除）。
