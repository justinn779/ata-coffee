"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useFieldArray, useForm, type Control, type UseFormRegister, type FieldErrors } from "react-hook-form";
import type { ActionResult } from "@/lib/action-result";
import { toast } from "./toast";
import { Button, cn } from "./ui";

export type Option = { value: string; label: string };
export interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "number" | "textarea" | "select" | "date" | "datetime" | "checkbox" | "mmss" | "email" | "password" | "array" | "hidden";
  options?: Option[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
  step?: string;
  unit?: string;
  section?: string;
  wide?: boolean;
  /** type=array 時的子欄位 */
  itemFields?: FieldDef[];
  addLabel?: string;
  newItem?: Record<string, string>;
}
export interface SectionDef {
  key: string;
  title: string;
  description?: string;
}

type Values = Record<string, unknown>;

const inputCls =
  "h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm text-fg placeholder:text-muted/70 aria-[invalid=true]:border-danger";

/**
 * 設定驅動的表單：React Hook Form + 伺服器端 Zod 驗證。
 *  - 草稿：自動暫存於本機瀏覽器（draftKey），送出成功後清除
 *  - 未儲存提醒：有修改時離開頁面會提示
 *  - 手機：多段表單改為逐段填寫（上一步 / 下一步）
 */
export function EntityForm({
  fields,
  sections,
  defaultValues = {},
  action,
  submitLabel = "儲存",
  draftKey,
  redirectTo,
  successMessage = "已儲存",
  footer,
}: {
  fields: FieldDef[];
  sections?: SectionDef[];
  defaultValues?: Values;
  action: (values: Values) => Promise<ActionResult<{ id?: string; redirect?: string } | unknown>>;
  submitLabel?: string;
  draftKey?: string;
  redirectTo?: string;
  successMessage?: string;
  footer?: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [hasDraft, setHasDraft] = useState(false);
  const submitted = useRef(false);
  const form = useForm<Values>({ defaultValues });
  const { register, handleSubmit, formState, setError, reset, watch, control } = form;

  const secs = useMemo(() => sections ?? [{ key: "_", title: "" }], [sections]);
  const fieldsOf = (k: string) => fields.filter((f) => (f.section ?? secs[0].key) === k);

  // 草稿還原與自動暫存
  useEffect(() => {
    if (!draftKey) return;
    try {
      if (localStorage.getItem("draft:" + draftKey)) setHasDraft(true);
    } catch {}
    const sub = watch((v) => {
      if (submitted.current) return;
      try {
        localStorage.setItem("draft:" + draftKey, JSON.stringify(v));
      } catch {}
    });
    return () => sub.unsubscribe();
  }, [draftKey, watch]);

  // 未儲存提醒
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (formState.isDirty && !submitted.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [formState.isDirty]);

  const onSubmit = handleSubmit((values) => {
    setServerError(null);
    start(async () => {
      const res = await action(values);
      if (!res.ok) {
        setServerError(res.error);
        toast(res.error, "error");
        for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) setError(k, { message: msg });
        const firstBad = Object.keys(res.fieldErrors ?? {})[0];
        if (firstBad) {
          const f = fields.find((x) => x.name === firstBad.split(".")[0]);
          const idx = secs.findIndex((s) => s.key === (f?.section ?? secs[0].key));
          if (idx >= 0) setStep(idx);
        }
        return;
      }
      submitted.current = true;
      if (draftKey)
        try {
          localStorage.removeItem("draft:" + draftKey);
        } catch {}
      toast(res.message ?? successMessage);
      const data = res.data as { id?: string; redirect?: string } | undefined;
      // 網址帶 ?next= 時，完成後回到原處（例如從咖啡豆頁新增杯測，存完回咖啡豆頁）
      const nx = new URLSearchParams(window.location.search).get("next");
      const back = nx && nx.startsWith("/") && !nx.startsWith("//") ? nx : null;
      const dest = back ?? data?.redirect ?? (redirectTo ? redirectTo.replace(":id", data?.id ?? "") : null);
      if (dest) router.push(dest);
      else {
        reset(values);
        router.refresh();
      }
    });
  });

  const multi = secs.length > 1;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {hasDraft && draftKey && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-info-soft px-4 py-2.5 text-sm text-fg">
          發現尚未送出的草稿。
          <button
            type="button"
            className="font-medium text-info underline"
            onClick={() => {
              try {
                reset({ ...defaultValues, ...JSON.parse(localStorage.getItem("draft:" + draftKey) ?? "{}") }, { keepDefaultValues: true });
              } catch {}
              setHasDraft(false);
            }}
          >
            還原草稿
          </button>
          <button
            type="button"
            className="text-muted underline"
            onClick={() => {
              try {
                localStorage.removeItem("draft:" + draftKey);
              } catch {}
              setHasDraft(false);
            }}
          >
            捨棄
          </button>
        </div>
      )}

      {multi && (
        <ol className="flex gap-1 overflow-x-auto md:hidden" aria-label="填寫步驟">
          {secs.map((s, i) => (
            <li key={s.key}>
              <button type="button" onClick={() => setStep(i)} className={cn("rounded-full px-3 py-1 text-xs whitespace-nowrap", i === step ? "bg-primary text-primary-fg" : "bg-surface-2 text-muted")}>
                {i + 1}. {s.title}
              </button>
            </li>
          ))}
        </ol>
      )}

      {secs.map((s, i) => (
        <fieldset key={s.key} className={cn("rounded-[var(--radius-card)] border border-border bg-surface p-5", multi && i !== step && "hidden md:block")}>
          {s.title && (
            <legend className="sr-only">{s.title}</legend>
          )}
          {s.title && (
            <div className="mb-4">
              <h2 className="text-[15px] font-semibold">{s.title}</h2>
              {s.description && <p className="mt-0.5 text-xs text-muted">{s.description}</p>}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {fieldsOf(s.key).map((f) => (
              <FieldInput key={f.name} f={f} register={register} errors={formState.errors} control={control} />
            ))}
          </div>
        </fieldset>
      ))}

      {serverError && (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          {serverError}
        </p>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        {multi && (
          <div className="flex gap-2 md:hidden">
            <Button type="button" variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>
              上一步
            </Button>
            {step < secs.length - 1 && (
              <Button type="button" variant="secondary" onClick={() => setStep(step + 1)}>
                下一步
              </Button>
            )}
          </div>
        )}
        <Button type="submit" disabled={pending} className="ml-auto md:ml-0">
          {pending ? "處理中…" : submitLabel}
        </Button>
        {formState.isDirty && !pending && <span className="text-xs text-muted">有未儲存的變更</span>}
        {footer}
      </div>
    </form>
  );
}

function getErr(errors: FieldErrors<Values>, name: string): string | undefined {
  const parts = name.split(".");
  let cur: unknown = errors;
  for (const p of parts) cur = (cur as Record<string, unknown> | undefined)?.[p];
  return (cur as { message?: string } | undefined)?.message;
}

function FieldInput({ f, register, errors, control }: { f: FieldDef; register: UseFormRegister<Values>; errors: FieldErrors<Values>; control: Control<Values> }) {
  const err = getErr(errors, f.name);
  const id = "f-" + f.name.replaceAll(".", "-");
  if (f.type === "hidden") return <input type="hidden" {...register(f.name)} />;
  if (f.type === "array") return <ArrayField f={f} register={register} errors={errors} control={control} />;
  const rules = { required: f.required ? `請填寫${f.label}` : false };
  const common = { id, "aria-invalid": !!err, "aria-describedby": err ? id + "-err" : f.hint ? id + "-hint" : undefined, ...register(f.name, rules) };
  let input: ReactNode;
  switch (f.type) {
    case "textarea":
      input = <textarea rows={3} className={cn(inputCls, "h-auto py-2")} placeholder={f.placeholder} {...common} />;
      break;
    case "select":
      input = (
        <select className={inputCls} {...common}>
          {!f.required && <option value="">（未選擇）</option>}
          {f.required && <option value="">請選擇…</option>}
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case "checkbox":
      return (
        <label className={cn("flex items-center gap-2 text-sm", f.wide && "sm:col-span-2 lg:col-span-3")}>
          <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" {...register(f.name)} />
          {f.label}
          {f.hint && <span className="text-xs text-muted">（{f.hint}）</span>}
        </label>
      );
    default:
      input = (
        <div className="relative">
          <input
            type={f.type === "number" ? "text" : f.type === "datetime" ? "datetime-local" : f.type === "mmss" ? "text" : (f.type ?? "text")}
            inputMode={f.type === "number" ? "decimal" : f.type === "mmss" ? "numeric" : undefined}
            placeholder={f.placeholder ?? (f.type === "mmss" ? "mm:ss" : undefined)}
            className={cn(inputCls, f.unit && "pr-12")}
            {...common}
          />
          {f.unit && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">{f.unit}</span>}
        </div>
      );
  }
  return (
    <div className={cn("min-w-0", f.wide && "sm:col-span-2 lg:col-span-3")}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {f.label}
        {f.required && <span className="text-danger"> *</span>}
      </label>
      {input}
      {err ? (
        <p id={id + "-err"} className="mt-1 text-xs text-danger">
          {err}
        </p>
      ) : (
        f.hint && (
          <p id={id + "-hint"} className="mt-1 text-xs text-muted">
            {f.hint}
          </p>
        )
      )}
    </div>
  );
}

function ArrayField({ f, register, errors, control }: { f: FieldDef; register: UseFormRegister<Values>; errors: FieldErrors<Values>; control: Control<Values> }) {
  const { fields, append, remove } = useFieldArray({ control, name: f.name as never });
  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <p className="mb-2 text-xs font-medium text-muted">{f.label}</p>
      <div className="space-y-2">
        {fields.map((row, i) => (
          <div key={row.id} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-border p-3 sm:grid-cols-[repeat(auto-fit,minmax(110px,1fr))_auto]">
            {f.itemFields!.map((sf) => (
              <FieldInput key={sf.name} f={{ ...sf, name: `${f.name}.${i}.${sf.name}` }} register={register} errors={errors} control={control} />
            ))}
            <button type="button" onClick={() => remove(i)} className="h-10 rounded-lg px-2 text-sm text-danger hover:bg-danger-soft" aria-label={`移除第 ${i + 1} 列`}>
              移除
            </button>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => append((f.newItem ?? {}) as never)}>
        ＋ {f.addLabel ?? "新增一列"}
      </Button>
    </div>
  );
}
