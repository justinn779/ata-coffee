"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, type Functions } from "firebase/functions";
import { connectStorageEmulator, getStorage, type FirebaseStorage } from "firebase/storage";
import { appCheckSiteKey, firebaseConfig } from "./firebase-config";

/**
 * Firebase 用戶端初始化。網頁設定值（apiKey 等）依 Firebase 設計本來就是公開的；
 * 資料安全由 Firestore／Storage 安全規則與 Cloud Functions 的伺服器端驗證保護。
 * NEXT_PUBLIC_USE_EMULATORS=1 時連線本機模擬器（開發與測試）。
 */
const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === "1";

let cached: { app: FirebaseApp; auth: Auth; db: Firestore; fns: Functions; storage: FirebaseStorage } | null = null;

export function fb() {
  if (cached) return cached;
  const app = getApps().length ? getApp() : initializeApp(useEmulators ? { ...firebaseConfig, projectId: "demo-ata-coffee", apiKey: "demo-key", storageBucket: "demo-ata-coffee.appspot.com" } : firebaseConfig);
  // App Check：證明呼叫來自本網站（reCAPTCHA Enterprise，背景執行、使用者看不到驗證題）。模擬器環境不啟用。
  if (!useEmulators && appCheckSiteKey && typeof window !== "undefined") {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  }
  const auth = getAuth(app);
  const db = getFirestore(app);
  const fns = getFunctions(app, "asia-east1");
  const storage = getStorage(app);
  if (useEmulators) {
    // 商城的精簡初始化（firebase-lite）可能已連線過 Auth／Functions 模擬器
    const once = (f: () => void) => {
      try {
        f();
      } catch {
        /* 已連線 */
      }
    };
    once(() => connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true }));
    once(() => connectFirestoreEmulator(db, "127.0.0.1", 8080));
    once(() => connectFunctionsEmulator(fns, "127.0.0.1", 5001));
    once(() => connectStorageEmulator(storage, "127.0.0.1", 9199));
  }
  cached = { app, auth, db, fns, storage };
  return cached;
}

export const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
