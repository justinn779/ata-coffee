/**
 * Firebase 網頁設定（公開資訊，可安全提交）。
 * 建立 Firebase 專案後，於「專案設定 → 一般 → 你的應用程式」取得並填入，
 * 或於建置時以環境變數 NEXT_PUBLIC_FIREBASE_* 覆寫。
 */
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo-ata-coffee",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
};
