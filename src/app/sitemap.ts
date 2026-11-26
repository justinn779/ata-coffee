import type { MetadataRoute } from "next";

export const dynamic = "force-static";

/** 商城公開頁面（商品頁網址為 /shop/p/?s=代稱，靜態匯出無法在建置時列出，見 docs/store/PLAN.md D18） */
export default function sitemap(): MetadataRoute.Sitemap {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://justinn779.github.io") + (process.env.NEXT_PUBLIC_BASE_PATH || "");
  return ["/shop/", "/shop/products/", "/shop/products/?c=beans", "/shop/products/?c=drip", "/shop/products/?c=gift", "/shop/page/?k=story", "/shop/page/?k=guide", "/shop/page/?k=contact"].map((p) => ({ url: `${site}${p}`, changeFrequency: "weekly" }));
}
