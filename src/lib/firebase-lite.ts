"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, type Functions } from "firebase/functions";
import { appCheckSiteKey, firebaseConfig } from "./firebase-config";

/**
 * 商城用的精簡 Firebase：只載入 Auth 與 Functions（不載入 Firestore、Storage），讓前台更輕、更快。
 * 與後台的 fb() 共用同一個 Firebase App（getApps），模擬器設定一致。
 */
const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === "1";
let cached: { app: FirebaseApp; auth: Auth; fns: Functions } | null = null;
let appCheckOn = false;

export function shopFb() {
  if (cached) return cached;
  const app = getApps().length ? getApp() : initializeApp(useEmulators ? { ...firebaseConfig, projectId: "demo-ata-coffee", apiKey: "demo-key", storageBucket: "demo-ata-coffee.appspot.com" } : firebaseConfig);
  if (!useEmulators && appCheckSiteKey && typeof window !== "undefined" && !appCheckOn) {
    try {
      initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
    } catch {
      /* 後台 fb() 已初始化過 */
    }
    appCheckOn = true;
  }
  const auth = getAuth(app);
  const fns = getFunctions(app, "asia-east1");
  if (useEmulators) {
    try {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    } catch {
      /* 已連線 */
    }
    try {
      connectFunctionsEmulator(fns, "127.0.0.1", 5001);
    } catch {
      /* 已連線 */
    }
  }
  cached = { app, auth, fns };
  return cached;
}

export const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
