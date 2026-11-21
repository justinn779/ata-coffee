import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { errorMessage } from "@/lib/errors";
import { requireActor } from "./auth";
import type { Actor } from "./domain/audit";

export type ActionResult<T = unknown> = { ok: true; data?: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Server Action 包裝：伺服器端驗證登入 → Zod 驗證輸入 → 執行 → 統一錯誤訊息（繁中）。
 */
export function action<S extends z.ZodTypeAny, T>(
  schema: S,
  fn: (input: z.infer<S>, actor: Actor) => Promise<T | ActionResult<T>>,
  opts?: { revalidate?: string[] },
) {
  return async (raw: unknown): Promise<ActionResult<T>> => {
    let actor: Actor;
    try {
      actor = await requireActor();
    } catch (e) {
      return { ok: false, error: (e as Error).message === "FORBIDDEN" ? "權限不足" : "登入已逾時，請重新登入" };
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const iss of parsed.error.issues) fieldErrors[iss.path.join(".")] ??= iss.message;
      return { ok: false, error: "輸入資料有誤，請檢查標示欄位", fieldErrors };
    }
    try {
      const res = await fn(parsed.data, actor);
      opts?.revalidate?.forEach((p) => revalidatePath(p, "layout"));
      if (res && typeof res === "object" && "ok" in (res as object)) return res as ActionResult<T>;
      return { ok: true, data: res as T };
    } catch (e) {
      if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
      return { ok: false, error: errorMessage(e) };
    }
  };
}
