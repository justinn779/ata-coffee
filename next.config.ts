import type { NextConfig } from "next";

/**
 * 靜態匯出（GitHub Pages）。
 * NEXT_PUBLIC_BASE_PATH：GitHub Pages 專案網址的子路徑（例：/ata-coffee）；本機開發留空。
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;
