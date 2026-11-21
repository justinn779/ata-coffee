# API 說明

## 1. 內部（管理後台）

管理後台的寫入操作皆為 **Server Actions**（`src/app/(app)/**/actions.ts`），同源呼叫、需登入（伺服器端 `requireActor()`），輸入以 Zod 驗證，回傳：

```ts
{ ok: true, data?, message? } | { ok: false, error: string, fieldErrors?: Record<string, string> }
```

Route Handlers：

| 方法 | 路徑 | 驗證 | 說明 |
| --- | --- | --- | --- |
| GET | `/api/health` | 無 | 健康檢查（含 DB 連線），不輸出敏感資訊 |
| GET | `/api/files/{key}` | Session | 讀取上傳檔案（曲線原始檔、品牌素材） |
| GET | `/api/export/{entity}` | Session | CSV 匯出（UTF-8 BOM、公式注入防護、寫入稽核）；entity：coffees、green-lots、roast-batches、cupping、brews、inventory-ledger、inventory-lots、orders、order-items、products、customers、monthly-report?month=YYYY-MM |
| POST | `/api/import/coffees` | Session | multipart CSV 匯入咖啡豆主檔（只新增，不覆寫） |

## 2. 未來官網（Storefront API v1）

供**官網後端伺服器**呼叫（伺服器對伺服器）。官網不得直接存取資料庫或修改庫存。

驗證：`Authorization: Bearer <API 金鑰>`（系統設定 → 前台 API 建立；只顯示一次，DB 只存雜湊）。速率限制：每金鑰每分鐘 60 次。

### GET `/api/storefront/v1/products`（scope `products:read`）

回傳上架中的 SKU（不含成本）：

```json
[{ "sku": "ATA001-YRG-100", "name": "ATA 001 晨光｜耶加雪菲｜100g 咖啡豆", "category": "COFFEE_BEAN",
   "series": "ATA 001", "listPrice": "450", "salePrice": "420", "flavorNotes": "…", "description": "…",
   "isLimited": false, "available": 6, "madeToOrder": true }]
```

### POST `/api/storefront/v1/orders`（scope `orders:create`）

標頭：`Idempotency-Key: <官網訂單唯一值>`（必填；重送回傳同一訂單，不重複建立、不重複保留）

```json
{
  "externalRef": "WEB-10001",
  "customer": { "name": "王小明", "phone": "0912…", "email": "a@b.c", "address": "…" },
  "shippingMethod": "宅配",
  "shippingFee": 80,
  "note": "",
  "items": [{ "sku": "ATA001-YRG-100", "quantity": 2 }]
}
```

- 只接受 SKU 與數量；價格、稅額、成本由本系統計算（不信任前端價格）。
- 經由與後台相同的 `createOrder`：同一交易中保留成品、必要時建立接單後分裝單；庫存不足回傳 409，訂單不成立。

回應 `201`（新建）或 `200`（重送）：

```json
{ "orderNo": "SO-20261121-007", "total": "920", "paymentStatus": "UNPAID", "fulfillmentStatus": "READY_TO_SHIP", "duplicate": false }
```

錯誤：`400` 格式錯誤、`401` 未授權、`409` 庫存不足或狀態衝突、`422` 業務規則錯誤、`429` 請求過於頻繁。

### 範例（PowerShell）

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/storefront/v1/orders -Headers @{ Authorization = "Bearer $env:ATA_API_KEY"; "Idempotency-Key" = "WEB-10001" } -ContentType "application/json" -Body '{"externalRef":"WEB-10001","customer":{"name":"測試"},"items":[{"sku":"DRIP-YRG-1","quantity":1}]}'
```

## 3. 公開頁

`/t/{publicCode}`：QR Code 商品履歷，不需登入，只顯示已發布批次的可公開欄位（咖啡豆介紹、產區處理法、烘焙日期、風味、推薦沖煮、批次編號、有效日期）；不含成本、研發備註或顧客資料。
