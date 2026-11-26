/**
 * 首頁與靜態頁內容（固定版型，不是拖拉式編輯器）。每個區塊有草稿與已發布兩份：
 * 後台編輯草稿 → 預覽 → 發布。沒有內容、沒有有效商品、不在活動期間的區塊自動隱藏。
 */
import type { Doc } from "../tx";
import { C } from "../types";
import { listProducts, type CatalogModel, type Reader } from "./catalog";

export type SectionType = "HERO" | "FEATURED" | "CATEGORIES" | "EVENT" | "PAGE" | "FOOTER" | "SEO";
export interface Block {
  title?: string | null;
  text?: string | null;
  body?: string | null;
  imageDesktop?: string | null;
  imageMobile?: string | null;
  imageAlt?: string | null;
  link?: string | null;
  linkLabel?: string | null;
  productIds?: string[];
  startAt?: string | null;
  endAt?: string | null;
}

/** 允許的連結：站內 /shop/ 路徑或 https 網址（避免 javascript: 等注入） */
export const safeLink = (u: unknown) => {
  const s = String(u ?? "").trim();
  if (!s) return null;
  if (s.startsWith("/shop/") || s === "/shop") return s;
  try {
    const url = new URL(s);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const inWindow = (b: Block, now: string) => (!b.startAt || b.startAt <= now) && (!b.endAt || b.endAt >= now);

export async function homeView(r: Reader, m: CatalogModel, opts?: { draft?: boolean }) {
  const now = m.now.toISOString();
  const all = (await r.query(C.content, [])).filter((d) => d.enabled !== false).sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
  const products = listProducts(m);
  const byId = new Map(products.map((p) => [p.id, p]));
  const pick = (d: Doc) => ((opts?.draft ? (d.draft ?? d.published) : d.published) ?? null) as Block | null;
  const sections: Array<Record<string, unknown>> = [];
  for (const d of all) {
    const b = pick(d);
    if (!b || !inWindow(b, now)) continue;
    const type = d.type as SectionType;
    if (type === "PAGE" || type === "FOOTER" || type === "SEO") continue;
    if (type === "HERO" && !b.imageDesktop && !b.imageMobile && !b.title) continue;
    if (type === "EVENT" && !b.imageDesktop && !b.imageMobile && !b.title) continue;
    if (type === "FEATURED") {
      const ps = (b.productIds ?? []).map((id) => byId.get(id)).filter((p) => !!p && p.state !== "SOLD_OUT");
      if (!ps.length) continue;
      sections.push({ id: d.id, type, title: b.title ?? null, products: ps });
      continue;
    }
    if (type === "CATEGORIES") {
      const cats = (["beans", "drip", "gift"] as const).map((k) => ({ key: k, count: products.filter((p) => p.category === k).length, image: products.find((p) => p.category === k && p.images.length)?.images[0]?.url ?? null })).filter((c) => c.count > 0);
      if (!cats.length) continue;
      sections.push({ id: d.id, type, title: b.title ?? null, categories: cats });
      continue;
    }
    sections.push({ id: d.id, type, title: b.title ?? null, text: b.text ?? null, imageDesktop: b.imageDesktop ?? null, imageMobile: b.imageMobile ?? b.imageDesktop ?? null, imageAlt: b.imageAlt ?? b.title ?? "", link: safeLink(b.link), linkLabel: b.linkLabel ?? null });
  }
  const footer = all.find((d) => d.type === "FOOTER");
  const seo = all.find((d) => d.type === "SEO");
  return { sections, footer: footer ? pick(footer) : null, seo: seo ? pick(seo) : null };
}

export async function pageView(r: Reader, key: string, opts?: { draft?: boolean }) {
  const d = (await r.query(C.content, [["type", "==", "PAGE"], ["key", "==", key]]))[0];
  if (!d || d.enabled === false) return null;
  const b = ((opts?.draft ? (d.draft ?? d.published) : d.published) ?? null) as Block | null;
  if (!b) return null;
  return { key, title: b.title ?? "", body: b.body ?? b.text ?? "", image: b.imageDesktop ?? null };
}
