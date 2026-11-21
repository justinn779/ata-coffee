"use client";

import { useSyncExternalStore } from "react";
import { cn } from "./ui";

type Toast = { id: number; tone: "success" | "error" | "info"; text: string };
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, tone: Toast["tone"] = "success") {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, tone, text }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, tone === "error" ? 7000 : 3500);
}

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
    () => toasts,
  );
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
      {list.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto max-w-md rounded-lg border px-4 py-3 text-sm shadow-lg whitespace-pre-line",
            t.tone === "success" && "border-sage bg-sage-soft text-fg",
            t.tone === "error" && "border-danger bg-danger-soft text-fg",
            t.tone === "info" && "border-info bg-info-soft text-fg",
          )}
        >
          {t.tone === "success" ? "✓ " : t.tone === "error" ? "⚠ " : ""}
          {t.text}
        </div>
      ))}
    </div>
  );
}
