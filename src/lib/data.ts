"use client";

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where, type QueryConstraint } from "firebase/firestore";
import { fb } from "./firebase";

export type Row = Record<string, any> & { id: string }; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * 即時讀取集合（onSnapshot）：Cloud Functions 寫入後畫面自動更新。
 * filters 為等值條件；排序在用戶端進行，避免需要建立複合索引。
 */
export function useCol(col: string | null, filters: Array<[string, unknown]> = [], sortBy?: string, desc = true) {
  const key = JSON.stringify([col, filters, sortBy, desc]);
  const [state, setState] = useState<{ data: Row[]; loading: boolean; error: string | null }>({ data: [], loading: !!col, error: null });
  useEffect(() => {
    if (!col) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const cons: QueryConstraint[] = filters.filter(([, v]) => v !== undefined && v !== null).map(([f, v]) => where(f, "==", v));
    return onSnapshot(
      query(collection(fb().db, col), ...cons),
      (snap) => {
        let data = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Row);
        if (sortBy) data = data.sort((a, b) => (String(a[sortBy] ?? "") < String(b[sortBy] ?? "") ? -1 : 1) * (desc ? -1 : 1));
        setState({ data, loading: false, error: null });
      },
      (err) => setState({ data: [], loading: false, error: err.code === "permission-denied" ? "沒有讀取權限" : err.message }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export function useDocument(col: string, id: string | null | undefined) {
  const [state, setState] = useState<{ data: Row | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  useEffect(() => {
    if (!id) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    return onSnapshot(
      doc(fb().db, col, id),
      (s) => setState({ data: s.exists() ? ({ ...s.data(), id: s.id } as Row) : null, loading: false, error: null }),
      (err) => setState({ data: null, loading: false, error: err.message }),
    );
  }, [col, id]);
  return state;
}

/** 讀取子集合（曲線時序資料分塊） */
export function useCurvePoints(curveIds: string[]) {
  const key = curveIds.join(",");
  const [points, setPoints] = useState<Record<string, Array<Record<string, number | null>>>>({});
  useEffect(() => {
    const unsubs = curveIds.map((cid) =>
      onSnapshot(collection(fb().db, `roastCurves/${cid}/chunks`), (snap) => {
        const pts = snap.docs.sort((a, b) => Number(a.id) - Number(b.id)).flatMap((d) => d.data().points as Array<Record<string, number | null>>);
        setPoints((p) => ({ ...p, [cid]: pts }));
      }),
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return points;
}

export const byId = (rows: Row[]) => new Map(rows.map((r) => [r.id, r]));

/** 呼叫唯讀操作（報表、追溯）並追蹤狀態 */
export function useOp<T>(op: string | null, input: unknown) {
  const key = JSON.stringify([op, input]);
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: !!op, error: null });
  useEffect(() => {
    if (!op) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    import("./api").then(({ callOp }) =>
      callOp<T>(op, input).then((r) => {
        if (!alive) return;
        setState(r.ok ? { data: (r.data ?? null) as T, loading: false, error: null } : { data: null, loading: false, error: r.error });
      }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
