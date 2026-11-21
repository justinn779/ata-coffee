/** 業務規則錯誤：訊息可直接顯示給使用者（繁體中文）。 */
export class DomainError extends Error {
  constructor(
    message: string,
    public code: string = "DOMAIN_ERROR",
    public status = 422,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string) {
    super(`找不到${what}`, "NOT_FOUND", 404);
  }
}

export class InsufficientStockError extends DomainError {
  constructor(message: string) {
    super(message, "INSUFFICIENT_STOCK", 409);
  }
}

export class InvalidStateError extends DomainError {
  constructor(message: string) {
    super(message, "INVALID_STATE", 409);
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof DomainError) return e.message;
  if (e && typeof e === "object" && "code" in e) {
    const code = (e as { code?: string }).code;
    if (code === "P2002") return "資料重複：編號或唯一欄位已存在";
    if (code === "P2003") return "關聯資料不存在或仍被其他資料使用";
    if (code === "P2025") return "找不到資料";
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/check constraint/i.test(msg)) return "資料違反庫存或數值限制（例如庫存不可為負）";
  if (/ledger_immutable/i.test(msg)) return "庫存帳本不可修改或刪除，請以沖銷交易更正";
  console.error(e);
  return "系統發生錯誤，請稍後再試";
}
