import { GoogleAuthProvider } from "firebase/auth";

/** Google 帳號登入／綁定（Firebase Auth）。管理員權限仍以 admins/{uid} 判斷，未綁定的 Google 帳號不會取得權限。 */
export function googleProvider() {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: "select_account" });
  return p;
}

export function googleErrorMessage(e: unknown): string | null {
  const code = (e as { code?: string }).code;
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return null; // 使用者自行關閉視窗，不顯示錯誤
    case "auth/popup-blocked":
      return "瀏覽器封鎖了登入視窗，請允許此網站開啟彈出視窗後再試";
    case "auth/credential-already-in-use":
    case "auth/email-already-in-use":
      return "這個 Google 帳號已綁定到其他使用者，無法重複綁定";
    case "auth/provider-already-linked":
      return "此帳號已綁定 Google";
    case "auth/requires-recent-login":
      return "為了安全，請先登出再重新登入後再操作";
    case "auth/account-exists-with-different-credential":
      return "此 Email 已有帳號，請先用密碼登入，再到「系統設定 → 個人帳號」綁定 Google";
    case "auth/operation-not-allowed":
      return "Google 登入尚未在 Firebase 啟用，請聯絡系統管理者";
    case "auth/unauthorized-domain":
      return "此網域尚未加入 Firebase 授權網域，請聯絡系統管理者";
    case "auth/too-many-requests":
      return "嘗試次數過多，請稍後再試";
    case "auth/network-request-failed":
      return "網路連線失敗，請稍後再試";
    default:
      return "Google 登入失敗，請稍後再試";
  }
}
