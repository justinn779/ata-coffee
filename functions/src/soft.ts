/**
 * 「提醒但不擋住」機制。
 * - warn(msg)：照樣執行，完成後把提醒回傳給畫面顯示。
 * - confirmOr(msg)：第一次送出時先回傳提醒請使用者確認（CONFIRM），使用者按「仍要繼續」後
 *   帶 force 重新送出，就照樣執行並記成提醒。
 * 沒有在 runOp 中執行（例如官網 API）時，confirmOr 一律擋住，避免自動流程在沒人確認下超賣。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { DomainError } from "../../src/lib/errors";

interface SoftStore {
  force: boolean;
  warnings: Set<string>;
}
const store = new AsyncLocalStorage<SoftStore>();

export function withSoft<T>(force: boolean, fn: () => Promise<T>) {
  const s: SoftStore = { force, warnings: new Set() };
  return store.run(s, async () => ({ result: await fn(), warnings: [...s.warnings] }));
}

export function warn(msg: string) {
  store.getStore()?.warnings.add(msg);
}

export class ConfirmError extends DomainError {
  constructor(message: string) {
    super(message, "CONFIRM", 409);
  }
}

export function confirmOr(msg: string) {
  const s = store.getStore();
  if (s?.force) {
    s.warnings.add(msg);
    return;
  }
  throw new ConfirmError(msg);
}
