import type { MetadataRoute } from "next";

export const dynamic = "force-static";
const bp = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** PWA：可「加到主畫面」，以獨立視窗開啟後台（手機烘豆室、出貨時使用） */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ATA Coffee 管理系統",
    short_name: "ATA 後台",
    description: "ATA Coffee 烘焙、庫存、訂單管理後台",
    lang: "zh-TW",
    start_url: `${bp}/`,
    scope: `${bp}/`,
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f7f3ec",
    theme_color: "#6b4a33",
    icons: [
      { src: `${bp}/icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${bp}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${bp}/icons/maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "建立訂單", url: `${bp}/orders/new/` },
      { name: "可出貨訂單", url: `${bp}/orders/?ful=READY_TO_SHIP` },
      { name: "開始烘焙", url: `${bp}/roasting/new/` },
    ],
  };
}
