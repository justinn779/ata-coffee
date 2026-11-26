import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource/noto-sans-tc/400.css";
import "@fontsource/noto-sans-tc/500.css";
import "@fontsource/noto-sans-tc/700.css";
import "@fontsource/noto-serif-tc/500.css";
import "@fontsource/noto-serif-tc/600.css";
import { Toaster } from "@/components/toast";
import "./globals.css";

const bp = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: { default: "ATA Coffee 管理系統", template: "%s｜ATA Coffee" },
  description: "ATA Coffee 咖啡品牌管理後台",
  robots: { index: false, follow: false },
  // 加到主畫面（iOS Safari 使用 apple-touch-icon 與 appleWebApp）
  icons: {
    icon: [
      { url: `${bp}/icons/favicon-32.png`, sizes: "32x32", type: "image/png" },
      { url: `${bp}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
    ],
    apple: `${bp}/icons/apple-touch-icon.png`,
  },
  appleWebApp: { capable: true, title: "ATA 後台", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f3ec" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1612" },
  ],
};

const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant-TW" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
