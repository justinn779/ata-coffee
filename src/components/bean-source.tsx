"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "./ui";

/**
 * 杯測／手沖的豆子來源：自家烘焙批次，或不經過烘豆紀錄（樣品、外購熟豆）直接記在咖啡豆上。
 * ?sample=1 / ?sample=0 指定；未指定時，若是從某支豆子進來且它還沒有烘豆紀錄，自動用「沒有烘豆紀錄」。
 */
export function sampleMode(sp: URLSearchParams, roast: string | null, roastCount: number) {
  const v = sp.get("sample");
  if (v === "1") return true;
  if (v === "0" || roast) return false;
  return !!sp.get("coffee") && roastCount === 0;
}

export function SourceSwitch({ sample }: { sample: boolean }) {
  const path = usePathname();
  const sp = useSearchParams();
  const href = (v: "0" | "1") => {
    const q = new URLSearchParams(sp);
    q.set("sample", v);
    q.delete("roast");
    return `${path}?${q}`;
  };
  const opt = (on: boolean, v: "0" | "1", label: string, tip: string) => (
    <Link href={href(v)} replace title={tip} aria-current={on ? "true" : undefined} className={cn("rounded-full border px-3 py-1.5", on ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface text-fg/80 hover:border-primary/50")}>
      {label}
    </Link>
  );
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="豆子來源">
      <span className="text-muted">豆子來源</span>
      {opt(!sample, "0", "自家烘焙批次", "選一個烘焙批次，可同步扣熟豆庫存")}
      {opt(sample, "1", "沒有烘豆紀錄", "樣品或外購熟豆：直接記在咖啡豆上，不扣庫存")}
    </div>
  );
}
