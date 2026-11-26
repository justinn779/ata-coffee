/**
 * 商城示範資料（只用於本機模擬器預覽）。所有資料標示「示範」，透過與正式環境相同的業務操作建立。
 * 包含：現貨咖啡豆、預購咖啡豆、濾掛、固定禮盒、自選禮盒、售完商品、即將推出、測試優惠、測試會員、
 * 已付款／未付款／待對帳／已出貨的商城訂單、首頁內容與各內容頁。
 */
import type { Firestore } from "firebase-admin/firestore";
import { runShopOp, type ShopCtx } from "../functions/src/shop/ops";
import { C } from "../functions/src/types";
import { POLICY_DRAFTS } from "./policy-drafts";

type Op = <T = { id: string }>(name: string, input: unknown) => Promise<T>;
const SITE = "http://127.0.0.1:4173/ata-coffee";
const img = (k: string) => `${SITE}/demo/${k}.svg`;
const DEMO = "（示範內容：正式上線前請由商家確認並替換）";

export async function seedStore(db: Firestore, op: Op, ids: { coffees: Array<{ id: string }>; mats: Record<string, string>; roastLots: string[]; pYrg: string; pCol: string; pDrip: string; pSet: string; pGift: string; yrg100: string; yrg200: string; col100: string; drip1: string; set5: string; gift1: string }) {
  // 商城設定（示範值，畫面會標示「示範」）
  await op("store.settings.save", {
    open: true,
    maintenance: false,
    maintenanceMessage: "",
    bank: { bankName: "示範銀行（請勿匯款）", bankCode: "000", branch: "示範分行", accountNo: "00012345678901", accountName: "ATA Coffee 示範帳戶", isDemo: true, qrImage: img("qr-demo") },
    paymentDeadlineHours: 72,
    paymentReminderHours: 24,
    shipping: { fee: "60", freeThreshold: "1500", freeBasis: "AFTER_ITEM_DISCOUNT", isDemo: true },
    pickupChannels: [
      { key: "SEVEN", label: "7-ELEVEN", enabled: true },
      { key: "FAMILY", label: "全家", enabled: true },
    ],
    prepDays: 2,
    nonShipWeekdays: [0],
    nonShipDates: [],
    grindOptions: [
      { key: "POUR_OVER", label: "手沖", enabled: true },
      { key: "ESPRESSO", label: "義式", enabled: true },
      { key: "FRENCH_PRESS", label: "法壓", enabled: true },
      { key: "MOKA", label: "摩卡壺", enabled: true },
      { key: "DRIP_MACHINE", label: "美式咖啡機", enabled: true },
      { key: "OTHER", label: "其他（備註說明）", enabled: true },
    ],
    minShelfDaysAtShip: 14,
    maxQtyPerLine: 20,
    service: { email: "service@example.test", phone: "", lineUrl: "", hours: "週一至週五 10:00–18:00（示範）" },
    social: { instagram: "https://www.instagram.com/", facebook: "", line: "" },
    business: { name: "", taxId: "", address: "", foodRegNo: "", phone: "" },
  });

  const details = (origin: string, process: string, roast: string) => [
    { title: "產地資訊", body: `${origin}\n處理法：${process}\n烘焙度：${roast}` },
    { title: "沖煮建議", body: "粉水比 1:15、水溫 90–92°C、總時間約 2 分 30 秒。" },
    { title: "保存方式", body: "開封後請擠出空氣並密封，置於陰涼處，避免冷藏。賞味期限標示於包裝。" },
  ];
  const ps = async (productId: string, slug: string, flavor: string, image: string, extra?: Record<string, unknown>) =>
    op("store.product.save", { productId, status: "ACTIVE", slug, flavor, summary: `${flavor}。${DEMO}`, images: [{ url: img(image), alt: "" }], details: [], grindable: true, sortOrder: 0, ...extra, force: true });
  await ps(ids.pYrg, "yirgacheffe", "茉莉花、檸檬、紅茶", "yirgacheffe", { details: details("衣索比亞 耶加雪菲 1900–2100m", "水洗", "淺焙"), sortOrder: 1 });
  await ps(ids.pCol, "colombia-huila", "焦糖、紅蘋果、可可", "colombia", { details: details("哥倫比亞 薇拉 1750m", "水洗", "中焙"), sortOrder: 2 });
  await ps(ids.pDrip, "drip-yirgacheffe", "花香、柑橘", "drip", { grindable: false, sortOrder: 5 });
  await ps(ids.pSet, "drip-set-5", "一週份的晨光", "dripset", { grindable: false, sortOrder: 6 });
  await ps(ids.pGift, "gift-ati", "咖啡豆與濾掛的組合", "gift", { grindable: false, sortOrder: 8 });

  // 預購：肯亞（接單後分裝；預購期間只看配額）
  const pKen = await op("product.save", { name: "ATA 003 肯亞 AA", category: "COFFEE_BEAN", coffeeId: ids.coffees[1].id, status: "ACTIVE", description: "示範商品" });
  const ken200 = await op("variant.save", { productId: pKen.id, name: "200g 咖啡豆", listPrice: "880", salePrice: "880", fillWeightG: "200", stockPolicy: "MADE_TO_ORDER", status: "ACTIVE", materials: [{ materialId: ids.mats["BAG-200"], quantityPerUnit: "1" }, { materialId: ids.mats["LBL-STD"], quantityPerUnit: "1" }] });
  await ps(pKen.id, "kenya-aa", "黑醋栗、莓果、明亮酸質", "kenya", { details: details("肯亞 涅里 1700m", "水洗", "淺中焙"), sortOrder: 3 });
  const ship = new Date(Date.now() + 21 * 86400_000 + 8 * 3600_000).toISOString().slice(0, 10);
  await op("store.preorder.save", { variantId: ken200.id, name: "新產季肯亞預購（示範）", startAt: null, endAt: null, cap: 20, shipDate: ship, status: "ACTIVE" });

  // 售完：瓜地馬拉（只有現貨，沒有庫存）
  const pGtm = await op("product.save", { name: "ATA 004 瓜地馬拉 安提瓜", category: "COFFEE_BEAN", coffeeId: ids.coffees[3].id, status: "ACTIVE", description: "示範商品" });
  await op("variant.save", { productId: pGtm.id, name: "100g 咖啡豆", listPrice: "400", salePrice: "400", fillWeightG: "100", stockPolicy: "STOCK_ONLY", status: "ACTIVE", materials: [] });
  await ps(pGtm.id, "guatemala-antigua", "黑巧克力、葡萄乾、堅果", "guatemala", { sortOrder: 4 });

  // 即將推出
  const pHon = await op("product.save", { name: "ATA 005 宏都拉斯", category: "COFFEE_BEAN", status: "ACTIVE", description: "示範商品" });
  await op("variant.save", { productId: pHon.id, name: "100g 咖啡豆", listPrice: "420", salePrice: "420", fillWeightG: "100", stockPolicy: "STOCK_ONLY", status: "ACTIVE", materials: [] });
  await ps(pHon.id, "honduras", "蜂蜜、杏桃", "honduras", { status: "COMING_SOON", sortOrder: 9 });

  // 自選禮盒：任選 3 件（咖啡豆 100g／濾掛），固定價 1,080，禮盒紙盒 1 個
  const pBox = await op("product.save", { name: "自選三入禮盒", category: "GIFT_BOX", status: "ACTIVE", description: "示範商品" });
  const box = await op("variant.save", { productId: pBox.id, name: "任選 3 件", listPrice: "1080", salePrice: "1080", isBundle: true, stockPolicy: "STOCK_ONLY", status: "ACTIVE", components: [{ componentVariantId: ids.yrg100, quantity: "1" }], materials: [{ materialId: ids.mats["BOX-GIFT"], quantityPerUnit: "1" }] });
  await op("store.variant.save", { variantId: box.id, visible: true, sortOrder: 0, customBundle: { eligibleVariantIds: [ids.yrg100, ids.col100, ids.drip1], min: 3, max: 3, allowRepeat: true, pricing: "FIXED", extra: "0" } });
  await ps(pBox.id, "gift-box-3", "挑三件送給重要的人", "giftbox", { grindable: false, sortOrder: 7 });

  // 測試優惠
  const promo = (d: Record<string, unknown>) => op("store.promotion.save", { id: null, active: true, startAt: null, endAt: null, value: null, appliesTo: "ALL", productIds: [], variantIds: [], minSpend: null, comboQty: null, usageLimit: null, perCustomerLimit: null, priority: 0, stackable: true, maxDiscount: null, code: null, ...d });
  await promo({ name: "新朋友折 100（示範）", code: "WELCOME100", type: "AMOUNT", value: "100", minSpend: "800", perCustomerLimit: 1 });
  await promo({ name: "全館 9 折（示範・不可併用）", code: "ATA10", type: "PERCENT", value: "10", stackable: false, maxDiscount: "300" });
  await promo({ name: "濾掛任 2 件折 30（示範）", type: "COMBO", appliesTo: "PRODUCTS", productIds: [ids.pDrip], comboQty: 2, value: "30" });

  // 首頁內容與內容頁（直接發布）
  const content = async (d: Record<string, unknown>) => {
    await op("store.content.save", { id: null, key: null, order: 0, enabled: true, ...d, draft: { title: null, text: null, body: null, imageDesktop: null, imageMobile: null, imageAlt: null, link: null, linkLabel: null, productIds: [], startAt: null, endAt: null, ...(d.draft as object) } });
    const last = (await db.collection(C.content).orderBy("createdAt", "desc").limit(1).get()).docs[0];
    await op("store.content.publish", { id: last.id });
  };
  await content({ type: "HERO", order: 1, draft: { title: "用一杯咖啡，開啟每段獨特體驗。", imageDesktop: img("hero-desktop"), imageMobile: img("hero-mobile"), imageAlt: "ATA Coffee 主視覺（示範）", link: "/shop/products/", linkLabel: "選購咖啡" } });
  await content({ type: "FEATURED", order: 2, draft: { title: "本期選集", productIds: [ids.pYrg, ids.pCol, pKen.id, ids.pDrip, pBox.id, pGtm.id] } });
  await content({ type: "CATEGORIES", order: 3, draft: { title: null } });
  await content({ type: "EVENT", order: 4, draft: { title: "冬日禮盒（示範活動）", text: "自選三入，送給重要的人", imageDesktop: img("event"), imageMobile: img("event-mobile"), imageAlt: "冬日禮盒活動（示範）", link: "/shop/p/?s=gift-box-3", startAt: null, endAt: null } });
  const page = (key: string, title: string, body: string) => content({ type: "PAGE", key, order: 100, draft: { title, body } });
  await page("story", "品牌故事", `用一杯咖啡，開啟每段獨特體驗。\n\nATA Coffee 相信每一杯咖啡都是一段旅程的開始。\n\n${DEMO}`);
  for (const k of ["guide", "returns", "privacy", "terms", "contact"]) await page(k, POLICY_DRAFTS[k].title, `${POLICY_DRAFTS[k].body}

（草稿：【請確認】處需商家確認後修改）`);

  // 測試會員與商城訂單（未付款、待對帳、已付款、已出貨）
  const who = (uid: string | null, email?: string): ShopCtx["who"] => ({ uid, email: email ?? null, emailVerified: true });
  let ip = 0;
  const shop = <T = Record<string, unknown>>(name: string, input: unknown, w = who(null)) => runShopOp(name, input, { db, who: w, ip: `seed-${ip++}`, provider: null, allowMock: true }) as Promise<T>;
  const memberUid = "mock-google-demo-member";
  await db.collection(C.shopCustomers).doc(memberUid).set({ providers: ["google"], name: "測試會員", contactEmail: "member@example.test", mock: true, savedStores: [{ carrier: "SEVEN", carrierLabel: "7-ELEVEN", storeId: "123456", storeName: "示範門市" }], createdAt: new Date().toISOString() });
  const place = async (lines: unknown[], contact: { name: string; phone: string; email: string }, w = who(null)) => {
    const q = (await shop<{ quote: { signature: string } }>("cart.quote", { lines }, w)).quote;
    return shop<{ orderId: string; token: string; orderNo: string }>("order.create", { lines, contact, pickup: { carrier: "SEVEN", storeId: "123456", storeName: "示範門市" }, agree: true, signature: q.signature, idempotencyKey: `seed-${Math.random()}-${Date.now()}`, note: "示範訂單" }, w);
  };
  const guest = { name: "示範訪客", phone: "0911111111", email: "guest@example.test" };
  const a = await place([{ variantId: ids.col100, qty: 1 }], guest);
  const b = await place([{ variantId: ids.drip1, qty: 2 }], { ...guest, name: "示範訪客二" });
  await shop("order.reportPayment", { token: b.token, last5: "01234" });
  const m = who(memberUid, "member@example.test");
  const c = await place([{ variantId: ids.yrg100, qty: 1, grind: "POUR_OVER" }, { variantId: ken200.id, qty: 1 }], { name: "測試會員", phone: "0922222222", email: "member@example.test" }, m);
  await op("order.confirmPayment", { orderId: c.orderId, reference: "末五碼 54321（示範）" });
  const d = await place([{ variantId: ids.drip1, qty: 1 }], { name: "測試會員", phone: "0922222222", email: "member@example.test" }, m);
  await op("order.confirmPayment", { orderId: d.orderId, reference: "末五碼 11111（示範）" });
  await op("order.ship", { orderId: d.orderId, carrier: "7-ELEVEN", trackingNo: "DEMO-SHIP-001" });
  console.log(`商城示範訂單：未付款 ${a.orderNo}、待對帳 ${b.orderNo}、已付款含預購 ${c.orderNo}、已出貨 ${d.orderNo}`);
  console.log(`訪客訂單連結（未付款）：${SITE}/shop/order/?t=${a.token}`);
}
