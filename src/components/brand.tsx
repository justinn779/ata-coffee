import Link from "next/link";

const bp = process.env.NEXT_PUBLIC_BASE_PATH || "";

/**
 * 品牌 Logo（public/brand/logo.png，黑色透明底；深色模式以 CSS 反白）。
 * compact：只顯示方形圖示；large：登入頁、QR 履歷頁等置中大圖
 */
export function BrandMark({ compact = false, large = false }: { compact?: boolean; large?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="ATA Coffee 首頁">
      {compact ? (
        <img src={`${bp}/icons/icon-192.png`} alt="ATA Coffee" width={36} height={36} className="h-9 w-9 shrink-0 rounded-full border border-border" />
      ) : large ? (
        <img src={`${bp}/brand/logo.png`} alt="ATA Coffee" width={120} height={74} className="brand-logo h-[74px] w-auto" />
      ) : (
        <>
          <img src={`${bp}/brand/logo.png`} alt="ATA Coffee" width={62} height={38} className="brand-logo h-[38px] w-auto" />
          <span className="border-l border-border pl-2.5 text-[11px] leading-tight tracking-wider text-muted">
            Management
            <br />
            System
          </span>
        </>
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
