/**
 * Firestore 交易工作單元（Unit of Work）。
 *
 * Firestore 交易規定「所有讀取必須在任何寫入之前」。為了讓業務邏輯可以自然地「讀 → 判斷 → 寫 → 再讀」，
 * 本層將寫入暫存在記憶體，於 commit() 時一次寫入；讀取時優先回傳暫存的最新版本（read-your-writes），
 * 查詢結果也會合併暫存寫入。Admin SDK 交易對讀取的文件加鎖，並行交易會被序列化或重試 → 不會超賣。
 *
 * 慣例：
 *  - 文件 id 存在 data.id
 *  - 十進位數（重量、金額、成本）一律存為字串，以 decimal.js 計算，避免浮點誤差
 *  - 時間存 ISO 8601 UTC 字串（可字典序排序）；純日期存 'YYYY-MM-DD'
 */
import { randomUUID } from "node:crypto";
import type { Firestore, Transaction, Query, WhereFilterOp } from "firebase-admin/firestore";
import { DomainError } from "../../src/lib/errors";

export type Doc = Record<string, unknown> & { id: string };
type Filter = [field: string, op: "==" | "!=" | "in" | "<" | "<=" | ">" | ">=" | "array-contains", value: unknown];

export class Tx {
  private cache = new Map<string, Doc | null>();
  private writes = new Map<string, Doc | null>(); // null = delete
  private writeOrder: string[] = [];
  constructor(
    readonly db: Firestore,
    private readonly t: Transaction,
  ) {}

  private key = (col: string, id: string) => `${col}/${id}`;

  async get<T extends Doc = Doc>(col: string, id: string): Promise<T | null> {
    const k = this.key(col, id);
    if (this.cache.has(k)) return (this.cache.get(k) as T | null) ?? null;
    const snap = await this.t.get(this.db.collection(col).doc(id));
    const d = snap.exists ? ({ ...(snap.data() as object), id } as T) : null;
    this.cache.set(k, d);
    return d;
  }

  async must<T extends Doc = Doc>(col: string, id: string, what: string): Promise<T> {
    const d = await this.get<T>(col, id);
    if (!d) throw new DomainError(`找不到${what}`, "NOT_FOUND", 404);
    return d;
  }

  /** 查詢（等值／範圍），並套用本交易尚未寫入的變更 */
  async query<T extends Doc = Doc>(col: string, filters: Filter[], opts?: { orderBy?: string; limit?: number }): Promise<T[]> {
    let q: Query = this.db.collection(col);
    for (const [f, op, v] of filters) q = q.where(f, op as WhereFilterOp, v);
    const snap = await this.t.get(q);
    const result = new Map<string, T>();
    for (const s of snap.docs) {
      const k = this.key(col, s.id);
      if (!this.cache.has(k)) this.cache.set(k, { ...(s.data() as object), id: s.id } as Doc);
      const cur = this.cache.get(k);
      if (cur && matches(cur, filters)) result.set(s.id, cur as T);
    }
    for (const [k, d] of this.writes) {
      if (!k.startsWith(col + "/") || k.split("/").length !== 2) continue;
      const id = k.slice(col.length + 1);
      if (d && matches(d, filters)) result.set(id, d as T);
      else result.delete(id);
    }
    let out = [...result.values()];
    if (opts?.orderBy) out.sort((a, b) => cmp(a[opts.orderBy!], b[opts.orderBy!]));
    if (opts?.limit) out = out.slice(0, opts.limit);
    return out;
  }

  set<T extends Record<string, unknown>>(col: string, id: string, data: T): T & { id: string } {
    const d = { ...data, id } as T & { id: string };
    const k = this.key(col, id);
    this.cache.set(k, d);
    if (!this.writes.has(k)) this.writeOrder.push(k);
    this.writes.set(k, d);
    return d;
  }

  create<T extends Record<string, unknown>>(col: string, data: T, id: string = randomUUID()): T & { id: string } {
    return this.set(col, id, data);
  }

  /** 合併更新（需先讀取過該文件） */
  async update<T extends Doc = Doc>(col: string, id: string, patch: Partial<T>): Promise<T> {
    const cur = await this.must<T>(col, id, "資料");
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    return this.set(col, id, { ...cur, ...clean }) as unknown as T;
  }

  /** 唯一性約束：以 uniq/{key} 文件佔位，重複則失敗 */
  async claimUnique(kind: string, value: string, message?: string) {
    const id = `${kind}:${value}`.replace(/\//g, "∕");
    if (await this.get("uniq", id)) throw new DomainError(message ?? `「${value}」已存在`, "DUPLICATE", 409);
    this.set("uniq", id, { kind, value, at: new Date().toISOString() });
  }

  async releaseUnique(kind: string, value: string) {
    await this.delete("uniq", `${kind}:${value}`.replace(/\//g, "∕"));
  }

  /** 刪除文件（先讀取以符合「讀取在寫入之前」並讓並行交易衝突時重試） */
  async delete(col: string, id: string) {
    const k = this.key(col, id);
    await this.get(col, id);
    this.cache.set(k, null);
    if (!this.writes.has(k)) this.writeOrder.push(k);
    this.writes.set(k, null);
  }

  /** 將暫存寫入交給 Firestore 交易（由 runTx 呼叫） */
  flush() {
    for (const k of this.writeOrder) {
      const d = this.writes.get(k);
      const ref = this.db.doc(k);
      if (d === null) this.t.delete(ref);
      else if (d) {
        const { id: _id, ...data } = d;
        void _id;
        this.t.set(ref, stripUndefined(data));
      }
    }
  }
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    out[k] = v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype ? stripUndefined(v as Record<string, unknown>) : Array.isArray(v) ? v.map((x) => (x && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype ? stripUndefined(x) : x)) : v;
  }
  return out;
}

function cmp(a: unknown, b: unknown) {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a as string) < (b as string) ? -1 : 1;
}

function matches(d: Doc, filters: Filter[]) {
  return filters.every(([f, op, v]) => {
    const x = d[f];
    switch (op) {
      case "==":
        return x === v;
      case "!=":
        return x !== v;
      case "in":
        return (v as unknown[]).includes(x);
      case "array-contains":
        return Array.isArray(x) && x.includes(v);
      case "<":
        return x != null && cmp(x, v) < 0;
      case "<=":
        return x != null && cmp(x, v) <= 0;
      case ">":
        return x != null && cmp(x, v) > 0;
      case ">=":
        return x != null && cmp(x, v) >= 0;
    }
  });
}

/** 執行交易（Firestore 遇到衝突會自動重試整個函式） */
export async function runTx<T>(db: Firestore, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.runTransaction(
    async (t) => {
      const tx = new Tx(db, t);
      const result = await fn(tx);
      tx.flush();
      return result;
    },
    { maxAttempts: 10 },
  );
}

export const nowIso = () => new Date().toISOString();
export const newId = () => randomUUID();
