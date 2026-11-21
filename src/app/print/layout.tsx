"use client";

import { Suspense } from "react";
import { AuthGate } from "@/components/auth";
import { Loading } from "@/lib/page";

/** 列印用版面：不含側欄與導覽，需登入（管理員） */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <Suspense fallback={<Loading />}>
        <div className="print-root min-h-dvh bg-white text-black">{children}</div>
      </Suspense>
    </AuthGate>
  );
}
