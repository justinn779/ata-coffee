import { DomainError } from "../../../src/lib/errors";

/** 商城 API 錯誤碼（前台依錯誤碼顯示對應畫面，訊息為繁體中文） */
export type ShopErrorCode =
  | "INSUFFICIENT_STOCK"
  | "PRICE_CHANGED"
  | "PREORDER_SOLD_OUT"
  | "PROMOTION_INVALID"
  | "PAYMENT_EXPIRED"
  | "ORDER_STATE_CONFLICT"
  | "INVALID_PICKUP_STORE"
  | "UNAUTHORIZED_ORDER_ACCESS"
  | "PRODUCT_UNAVAILABLE"
  | "INVALID_BUNDLE"
  | "STORE_CLOSED"
  | "RATE_LIMITED"
  | "CODE_INVALID"
  | "LOGIN_REQUIRED"
  | "NOT_CONFIGURED";

const STATUS: Partial<Record<ShopErrorCode, number>> = { UNAUTHORIZED_ORDER_ACCESS: 403, RATE_LIMITED: 429, LOGIN_REQUIRED: 401, NOT_CONFIGURED: 503 };

export class ShopError extends DomainError {
  constructor(
    code: ShopErrorCode,
    message: string,
    public data: Record<string, unknown> | null = null,
  ) {
    super(message, code, STATUS[code] ?? 409);
    this.name = "ShopError";
  }
}
