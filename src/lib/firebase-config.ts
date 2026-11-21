/**
 * Firebase 網頁設定（公開資訊，可安全提交）。
 * 建立 Firebase 專案後，於「專案設定 → 一般 → 你的應用程式」取得並填入，
 * 或於建置時以環境變數 NEXT_PUBLIC_FIREBASE_* 覆寫。
 */
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyA90TkHn_LOOpfhJqCtlEjyRHEHv4j0D3k",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "ata-coffee.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "ata-coffee",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "ata-coffee.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "995684412455",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:995684412455:web:8c0c6c52f8527fe06e3202",
};

/** App Check 用的 reCAPTCHA Enterprise 網站金鑰（公開資訊；僅限 justinn779.github.io 網域可用） */
export const appCheckSiteKey = process.env.NEXT_PUBLIC_APPCHECK_SITE_KEY || "6LeadCsuAAAAAIuu5o6NtHQnIT0QKorAfTHsc-4R";
