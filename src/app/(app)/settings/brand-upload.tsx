"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui";
import { toast } from "@/components/toast";
import { uploadBrandAsset } from "./actions";

export function BrandUpload() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <form
      action={(fd) =>
        start(async () => {
          const r = await uploadBrandAsset(fd);
          if (!r.ok) return toast(r.error ?? "上傳失敗", "error");
          toast("已上傳");
          router.refresh();
        })
      }
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
    >
      <label className="text-xs text-muted">
        類型
        <select name="kind" className="mt-1 h-10 w-full rounded-lg border border-border bg-bg px-2 text-sm text-fg">
          <option value="LOGO">Logo</option>
          <option value="MASCOT_ATI">吉祥物 Ati</option>
          <option value="MASCOT_ATO">吉祥物 Ato</option>
          <option value="PACKAGING">包裝設計</option>
          <option value="OTHER">其他</option>
        </select>
      </label>
      <label className="text-xs text-muted">
        名稱
        <input name="name" className="mt-1 h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm text-fg" />
      </label>
      <label className="text-xs text-muted">
        圖片（JPG／PNG／WebP，5MB 內）
        <input name="file" type="file" accept=".jpg,.jpeg,.png,.webp" required className="mt-1 block w-full text-sm" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isOfficial" className="accent-[var(--primary)]" /> 這是 ATA 正式官方素材
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "上傳中…" : "上傳"}
      </Button>
    </form>
  );
}
