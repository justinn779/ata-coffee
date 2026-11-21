"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";
import { Button } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(loginAction, { error: null as string | null });
  return (
    <form action={formAction} className="mt-5 space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">電子郵件</span>
        <input name="email" type="email" autoComplete="username" required className="h-11 w-full rounded-lg border border-border bg-bg px-3 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">密碼</span>
        <input name="password" type="password" autoComplete="current-password" required className="h-11 w-full rounded-lg border border-border bg-bg px-3 text-sm" />
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-11 w-full">
        {pending ? "登入中…" : "登入"}
      </Button>
    </form>
  );
}
