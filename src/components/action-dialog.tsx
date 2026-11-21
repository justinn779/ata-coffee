"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/server/action";
import { toast } from "./toast";
import { Button, buttonClass, cn } from "./ui";

export interface DialogField {
  name: string;
  label: string;
  type?: "text" | "number" | "select" | "textarea" | "date" | "datetime";
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string;
  required?: boolean;
  hint?: string;
}

/**
 * 重要操作按鈕：開啟確認對話框（可含額外欄位），執行 Server Action，顯示結果並重新整理。
 * 送出期間按鈕停用，避免重複送出（伺服器端另有冪等保護）。
 */
export function ActionDialog({
  label,
  title,
  description,
  confirmLabel = "確認",
  variant = "primary",
  size = "md",
  fields = [],
  payload = {},
  action,
  successMessage = "完成",
  redirectTo,
}: {
  label: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  variant?: "primary" | "secondary" | "outline" | "danger" | "ghost";
  size?: "sm" | "md";
  fields?: DialogField[];
  payload?: Record<string, unknown>;
  action: (input: Record<string, unknown>) => Promise<ActionResult<unknown>>;
  successMessage?: string;
  redirectTo?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = (fd: FormData) => {
    setError(null);
    const values: Record<string, unknown> = { ...payload };
    for (const f of fields) values[f.name] = fd.get(f.name) ?? "";
    start(async () => {
      const res = await action(values);
      if (!res.ok) {
        setError(res.error + (res.fieldErrors ? "\n" + Object.values(res.fieldErrors).join("\n") : ""));
        return;
      }
      ref.current?.close();
      toast(res.message ?? successMessage);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  };

  return (
    <>
      <button type="button" className={buttonClass(variant, size)} onClick={() => ref.current?.showModal()}>
        {label}
      </button>
      <dialog ref={ref} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-0 text-fg backdrop:bg-black/40">
        <form action={submit} className="p-5">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <div className="mt-1 text-sm text-muted">{description}</div>}
          <div className="mt-4 space-y-3">
            {fields.map((f) => (
              <label key={f.name} className="block">
                <span className="mb-1 block text-xs font-medium text-muted">
                  {f.label}
                  {f.required && <span className="text-danger"> *</span>}
                </span>
                {f.type === "select" ? (
                  <select name={f.name} defaultValue={f.defaultValue} required={f.required} className="h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm">
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea name={f.name} defaultValue={f.defaultValue} required={f.required} rows={3} className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm" />
                ) : (
                  <input
                    name={f.name}
                    type={f.type === "datetime" ? "datetime-local" : f.type === "date" ? "date" : "text"}
                    inputMode={f.type === "number" ? "decimal" : undefined}
                    defaultValue={f.defaultValue}
                    required={f.required}
                    className="h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm"
                  />
                )}
                {f.hint && <span className="mt-1 block text-xs text-muted">{f.hint}</span>}
              </label>
            ))}
          </div>
          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm whitespace-pre-line text-danger">
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => ref.current?.close()}>
              取消
            </Button>
            <Button type="submit" variant={variant === "danger" ? "danger" : "primary"} disabled={pending} className={cn(pending && "cursor-wait")}>
              {pending ? "處理中…" : confirmLabel}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
