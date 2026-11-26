import Link from "next/link";
import "./shop/shop.css";

/** 404（GitHub Pages 對所有不存在的網址回傳此頁） */
export default function NotFound() {
  const bp = process.env.NEXT_PUBLIC_BASE_PATH || "";
  return (
    <div className="shop">
      <main className="s-wrap flex flex-1 flex-col items-center justify-center py-24 text-center">
        <img src={`${bp}/brand/logo.png`} alt="ATA Coffee" width={72} height={44} className="h-10 w-auto" />
        <div role="img" aria-label="Ato 角色佔位圖（找不到頁面）" className="mt-12 flex h-28 w-28 flex-col items-center justify-center rounded-full border border-dashed border-[var(--s-accent)]">
          <span className="serif text-base text-[var(--s-brand)]">Ato</span>
          <span className="mt-1 text-[10px] leading-tight text-[var(--s-muted)]">
            角色素材
            <br />
            待替換
          </span>
        </div>
        <h1 className="serif mt-8 text-2xl">找不到這個頁面</h1>
        <div className="mt-8 flex gap-3">
          <Link href="/shop/" className="s-btn">
            回到商城
          </Link>
        </div>
      </main>
    </div>
  );
}
