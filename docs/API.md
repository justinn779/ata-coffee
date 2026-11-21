# API 說明

## 1. 管理後台：Callable Function `api`

前端以 `httpsCallable(functions, "api")({ op, input })` 呼叫（`src/lib/api.ts`）。每次呼叫：驗證 Firebase Auth → 檢查 `admins/{uid}` → Zod 驗證 → 在 Firestore 交易中執行。完整清單見 `functions/src/ops.ts`：

| 分類 | 操作 |
| --- | --- |
| 咖啡豆／生豆 | `coffee.save`、`coffee.archive`、`green.receive`、`green.correctCost` |
| 烘焙 | `roast.create`、`roast.updateNotes`、`curve.preview`、`curve.import`、`curve.activate` |
| 研發 | `cupping.create`、`brew.create`、`brew.toggleRecommended`、`recipe.saveFromBrew`、`recipe.toggleRecommended`、`research.save`、`research.addExperiment`、`research.setBaseline` |
| 庫存 | `inventory.adjust`、`inventory.reverse`、`inventory.lotStatus`、`inventory.threshold`、`inventory.receiveMaterial`、`inventory.reconcile` |
| 分裝 | `production.create`、`production.complete`、`production.cancel` |
| 商品 | `product.save`、`variant.save` |
| 訂單 | `order.create`、`order.markPending`、`order.confirmPayment`、`order.ship`、`order.complete`、`order.cancel`、`order.refund`、`order.return`、`order.inspectReturn`、`order.addCost`、`order.trace`、`customer.save` |
| 報表 | `report.monthly`、`report.sku`、`report.loss`、`cost.addPeriod`、`cost.addRule` |
| 品牌 | `series.save`、`trace.setPublished`、`brand.register` |
| 設定 | `supplier.save`、`roaster.save`、`equipment.save`、`flavor.save`、`template.create`、`material.save`、`location.save`、`settings.save`、`apikey.create`、`apikey.revoke`、`admin.add`、`admin.claimFirst` |

錯誤：`invalid-argument`（含 `details.fieldErrors`）、`unauthenticated`、`permission-denied`、`not-found`、`failed-precondition`（庫存不足、狀態不符），訊息為繁體中文。

## 2. 未來官網：HTTP Function `storefront`

網址：`https://asia-east1-<專案ID>.cloudfunctions.net/storefront/...`（伺服器對伺服器；金鑰只能放官網伺服器）

驗證：`Authorization: Bearer <API 金鑰>`；每金鑰每分鐘 60 次。

- `GET /products`（scope `products:read`）：上架中 SKU、售價、可售量（不含成本）
- `POST /orders`（scope `orders:create`）：標頭 `Idempotency-Key` 必填，重送不重複建單

```json
{ "externalRef": "WEB-10001", "customer": { "name": "王小明", "phone": "0912…" }, "shippingFee": 80, "items": [{ "sku": "ATA001-YRG-100", "quantity": 2 }] }
```

只接受 SKU 與數量；價格、稅額、成本、庫存保留由同一個 `createOrder` 決定。回應 `201`／`200`（重送）`{ orderNo, total, paymentStatus, fulfillmentStatus, duplicate }`；庫存不足 `409`。

## 3. 公開頁

`/t/?c=<代碼>`：QR 商品履歷，讀取 `publicTraces/{代碼}`（僅已發布、僅可公開欄位）。
