"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { cn } from "./ui";

type Toast = { id: number; tone: "success" | "error" | "info" | "warn"; text: string };
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, tone: Toast["tone"] = "success") {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, tone, text }];
  emit();
  setTimeout(
    () => {
      toasts = toasts.filter((t) => t.id !== id);
      emit();
    },
    tone === "warn" ? 12000 : tone === "error" ? 7000 : 3500,
  );
}

// ── 提醒確認（資料之間有關聯時，先問使用者，確認後照樣執行） ──
type Ask = { text: string; resolve: (ok: boolean) => void };
let asking: Ask | null = null;

export function askConfirm(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    asking?.resolve(false);
    asking = { text, resolve };
    emit();
  });
}

function answer(ok: boolean) {
  const a = asking;
  asking = null;
  emit();
  a?.resolve(ok);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function ConfirmHost() {
  const ask = useSyncExternalStore(subscribe, () => asking, () => null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (ask && !d.open) d.showModal();
    if (!ask && d.open) d.close();
  }, [ask]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="soft-confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        answer(false);
      }}
      className="z-[110] m-auto w-[calc(100%-2rem)] max-w-md rounded-[var(--radius-card)] border border-warning bg-surface p-0 text-fg backdrop:bg-black/40"
    >
      <div className="p-5">
        <h2 id="soft-confirm-title" className="text-base font-semibold">
          ⚠ 提醒
        </h2>
        <p className="mt-2 text-sm whitespace-pre-line">{ask?.text}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="h-10 rounded-lg px-4 text-sm hover:bg-bg" onClick={() => answer(false)}>
            先不要
          </button>
          <button type="button" className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg" onClick={() => answer(true)}>
            仍要繼續
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts, () => toasts);
  return (
    <>
      <ConfirmHost />
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {list.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto max-w-md rounded-lg border px-4 py-3 text-sm shadow-lg whitespace-pre-line",
              t.tone === "success" && "border-sage bg-sage-soft text-fg",
              t.tone === "error" && "border-danger bg-danger-soft text-fg",
              t.tone === "info" && "border-info bg-info-soft text-fg",
              t.tone === "warn" && "border-warning bg-warning-soft text-fg",
            )}
          >
            {t.tone === "success" ? "✓ " : t.tone === "error" || t.tone === "warn" ? "⚠ " : ""}
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
