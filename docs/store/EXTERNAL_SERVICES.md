# 外部服務評估（物流、登入、Email）與法規重點

> 費用與條件以各服務商最新公告、合約為準；本文件不代表已完成申請或串接。

## 一、超商取貨物流（7-ELEVEN、全家，取貨不付款）

| 方案 | 能否用於自有商城 | 銀行轉帳＋純取貨 | 門市選擇 | 建單／追蹤 | 參考費用 | 維護成本 |
| --- | --- | --- | --- | --- | --- | --- |
| **A. 人工（目前實作：ManualProvider）** | 可 | 可 | 顧客從官方門市查詢頁取得 6 碼店號填寫 | 商家到門市寄件（如：交貨便／店到店），後台輸入物流單號、手動更新到店／取貨 | 依各超商寄件價格 | 低（無串接），人工作業多 |
| **B. 第三方物流整合（例：綠界 ECPay 物流）** | 可（綠界賣家帳號） | 支援「取貨不付款」 | 官方電子地圖選店（回傳店號，正式驗證） | API 建立物流單、狀態通知（Webhook） | C2C 7-ELEVEN、全家約 65 元／筆；B2C 大宗寄倉約 55 元／筆（另加 5% 營業稅，依官網） | 中：需串接 API、驗證回傳檢查碼 |
| C. 超商自有 B2C 合約 | 需與超商簽約、出貨量門檻 | 可 | 官方地圖 | 物流中心大宗寄倉 | 依合約 | 高，初期不划算 |

**決策（ADR D15）**：第一版使用 **A. 人工流程**，並建立 `LogisticsProvider` 介面（目前為 `ManualProvider` 行為：門市資料來源標記 `source: "MANUAL"`、`verified: false`）。
**建議下一步**：出貨量穩定後申請 **綠界物流（C2C 取貨不付款）**，加入 `EcpayProvider`：電子地圖選店（`verified: true`）、建單 API、物流狀態 Webhook（需驗證 CheckMacValue）。需商家本人申請綠界帳號並提供 HashKey／HashIV。

## 二、會員登入

| 服務 | 狀態 | 正式啟用需要 |
| --- | --- | --- |
| Google | 使用 Firebase Auth Google 登入（後台已在用） | Firebase Console → Authentication 確認 Google 已啟用、商城網域在「授權網域」 |
| LINE Login | 已實作 OAuth 2.1 + PKCE + state + nonce，由 LINE verify API 驗證 id_token；模擬器提供明確標示的模擬授權頁 | 商家在 LINE Developers 建立 LINE Login channel，設定 Callback URL `https://asia-east1-ata-coffee.cloudfunctions.net/lineAuth/callback`，把 Channel ID／Secret 放入 `functions/.env.ata-coffee`（不進 Git） |
| 帳號綁定 | 已登入會員可在會員中心「綁定 LINE」（以已登入身分發一次性綁定碼，安全對應到原帳號） | — |

## 三、Email 通知

- 實作：交易內寫入 `notifyOutbox`（去重）→ 提交後由觸發器 `outboxSend` 與排程 `shopTasks` 寄出，失敗以 1／5／30／120／720 分鐘重試，最多 6 次。
- 目前使用後台已設定的 **Gmail SMTP（應用程式密碼）**。Gmail 個人帳號每日寄送量有限（約 500 封），訂單量成長後建議改用交易型 Email 服務（例：SendGrid、Amazon SES、Resend），只需新增一個 `NotificationProvider`。
- LINE 通知：保留 `NotificationProvider` 介面（channel: "LINE"），尚未實作；需 LINE 官方帳號 Messaging API。

## 四、台灣網路販售食品與消費交易（重點整理，需商家確認）

1. **食品業者登錄**：具商業／公司登記的販售業者，不論有無實體店面都需完成食品業者登錄，網購頁面應揭露登錄字號（[衛福部說明](https://mohw.gov.tw/cp-2645-20548-1.html)）。→ 商城頁尾已預留，未填顯示「待補」。
2. **網頁揭露**：企業經營者名稱、聯絡方式、商品內容物、淨重等（[衛福部](https://mohw.gov.tw/cp-16-38947-1.html)）。→ 商品頁「收合資訊」提供食品標示欄位，需商家填寫。
3. **包裝標示**：網路販售之包裝食品須符合市售包裝食品標示規範（食品安全衛生管理法第 22 條）。
4. **七日解除權**：消費者保護法第 19 條；「[通訊交易解除權合理例外情事適用準則](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=J0170012)」第 2 條列有「易於腐敗、保存期限較短」「依消費者要求所為之客製化給付」等例外，**且須事先告知**。熟豆保存期限通常數個月，**不一定**屬於例外；代客研磨是否屬客製化亦需確認。→ 商城**沒有**宣稱咖啡商品一律不適用七日解除權，「退換貨」頁留給商家依法確認後填寫。
5. **個人資料保護法**：隱私權政策需載明蒐集目的、類別、利用期間／地區／對象／方式與當事人權利。→ 「隱私權政策」頁為待補內容。

Sources：[綠界服務費率](https://www.ecpay.com.tw/Business/payment_fees)、[綠界物流類型](https://support.ecpay.com.tw/21685/)、[綠界物流服務](https://www.ecpay.com.tw/IntroTransport)、[綠界超商物流費用](https://www.ecpay.com.tw/IntroTransport/Service_Fee)、[衛福部 食品業者登錄](https://mohw.gov.tw/cp-2645-20548-1.html)、[衛福部 網購食品](https://mohw.gov.tw/cp-16-38947-1.html)、[通訊交易解除權合理例外情事適用準則](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=J0170012)
