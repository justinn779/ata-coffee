import Link from "next/link";

/**
 * 品牌標誌「佔位」元件。
 * ATA Coffee 已有正式 Logo 與 Ati / Ato 吉祥物，但尚未取得原始素材，
 * 這裡只顯示文字標記並明確標示為佔位；正式素材請於「系統設定 → 品牌素材」上傳後替換。
 */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="ATA Coffee 首頁">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-accent text-[10px] font-semibold tracking-wider text-primary"
        title="Logo 佔位：請上傳正式 Logo"
      >
        ATA
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block font-serif text-[15px] font-semibold tracking-[0.12em] text-fg">ATA COFFEE</span>
          <span className="block text-[10px] tracking-wider text-muted">Management System</span>
        </span>
      )}
    </Link>
  );
}

export function MascotPlaceholder({ name }: { name: "Ati" | "Ato" }) {
  return (
    <div className="flex aspect-square w-full flex-col items-center justify-center rounded-xl border border-dashed border-accent bg-primary-soft/50 p-3 text-center">
      <span className="font-serif text-lg text-primary">{name}</span>
      <span className="mt-1 text-[11px] text-muted">吉祥物素材佔位</span>
      <span className="text-[11px] text-muted">（非官方圖像）</span>
    </div>
  );
}
