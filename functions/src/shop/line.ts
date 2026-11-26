/**
 * LINE Login（OAuth 2.1 / OpenID Connect）：authorization code + PKCE(S256) + state + nonce。
 *  /start    產生 state、nonce、code_verifier（存 Firestore，10 分鐘），導向 LINE 授權頁
 *  /callback 驗證 state（一次性）→ 以 code_verifier 換 token → 呼叫 LINE verify API 驗證 id_token（client_id、nonce）
 *            → 建立／對應 Firebase 帳號 → 發一次性登入票（1 分鐘）導回商城，前台用票換 Custom Token
 * 帳號綁定：已登入的會員先呼叫 shop `auth.lineLinkStart` 取得綁定 state，LINE 驗證成功後對應到原本的帳號。
 * 沒有設定 LINE 憑證時：正式環境回覆「尚未設定」；模擬器提供明確標示的模擬授權頁。
 */
import type { Request, Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { createHash, randomBytes } from "node:crypto";
import { C } from "../types";
import { SITE_URL } from "../notify/notify";
import { sha } from "./orders";

const b64 = (b: Buffer) => b.toString("base64url");

export interface LineConfig {
  channelId: string;
  channelSecret: string;
  callbackUrl: string;
  mock: boolean;
}

/** 只允許導回本站商城頁面（避免 open redirect） */
function safeReturn(site: string, v: unknown) {
  const s = String(v ?? "");
  return s.startsWith("/shop/") && !s.startsWith("//") && !s.includes("\\") ? s : "/shop/account/";
}

export async function lineStart(db: Firestore, cfg: LineConfig, req: Request, res: Response, site = SITE_URL) {
  if (!cfg.mock && (!cfg.channelId || !cfg.channelSecret)) return void res.status(503).send("LINE 登入尚未設定");
  const state = b64(randomBytes(24));
  const nonce = b64(randomBytes(24));
  const verifier = b64(randomBytes(48));
  const challenge = b64(createHash("sha256").update(verifier).digest());
  const link = String(req.query.link ?? "");
  let linkUid: string | null = null;
  if (link) {
    const l = (await db.collection(C.oauthStates).doc(`link-${sha(link)}`).get()).data();
    if (l && l.expiresAt > new Date().toISOString()) linkUid = l.uid as string;
    await db.collection(C.oauthStates).doc(`link-${sha(link)}`).delete();
  }
  await db.collection(C.oauthStates).doc(sha(state)).set({ nonce, verifier, returnTo: safeReturn(site, req.query.return), linkUid, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });
  if (cfg.mock) return void res.redirect(302, `${cfg.callbackUrl.replace(/\/callback$/, "/mock")}?state=${encodeURIComponent(state)}`);
  const u = new URL("https://access.line.me/oauth2/v2.1/authorize");
  u.search = new URLSearchParams({ response_type: "code", client_id: cfg.channelId, redirect_uri: cfg.callbackUrl, state, scope: "openid profile email", nonce, code_challenge: challenge, code_challenge_method: "S256" }).toString();
  res.redirect(302, u.toString());
}

/** 模擬器專用：模擬 LINE 授權頁（頁面明確標示為測試） */
export function lineMockPage(cfg: LineConfig, req: Request, res: Response) {
  if (!cfg.mock) return void res.status(404).send("Not found");
  const state = String(req.query.state ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  res.set("Content-Type", "text/html; charset=utf-8").send(`<!doctype html><meta name=viewport content="width=device-width"><body style="font-family:sans-serif;padding:24px;background:#FCFAF6">
<p style="background:#F0EBE2;padding:8px 12px">⚠ 測試環境的模擬 LINE 登入（不是真正的 LINE）</p>
<form method="get" action="${cfg.callbackUrl}"><input type="hidden" name="state" value="${state}"><input type="hidden" name="code" value="mock">
<label>顯示名稱 <input name="mock_name" value="LINE 測試會員"></label><br><br>
<label>Email <input name="mock_email" value="line-member@example.test"></label><br><br>
<button style="padding:10px 20px">同意並登入</button></form></body>`);
}

export async function lineCallback(db: Firestore, cfg: LineConfig, req: Request, res: Response, site = SITE_URL) {
  const fail = (msg: string) => res.redirect(302, `${site}/shop/login/?error=${encodeURIComponent(msg)}`);
  const state = String(req.query.state ?? "");
  const code = String(req.query.code ?? "");
  if (!state || !code) return void fail("LINE 登入已取消");
  const ref = db.collection(C.oauthStates).doc(sha(state));
  const st = await db.runTransaction(async (t) => {
    const d = (await t.get(ref)).data();
    if (d) t.delete(ref); // 一次性
    return d;
  });
  if (!st || st.expiresAt < new Date().toISOString()) return void fail("登入逾時，請重新登入");
  let sub: string, name: string | null, email: string | null;
  if (cfg.mock) {
    email = String(req.query.mock_email ?? "line-member@example.test").slice(0, 200);
    name = String(req.query.mock_name ?? "LINE 測試會員").slice(0, 40);
    sub = `mock-${sha(email).slice(0, 16)}`;
  } else {
    const tok = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: cfg.callbackUrl, client_id: cfg.channelId, client_secret: cfg.channelSecret, code_verifier: st.verifier }),
      signal: AbortSignal.timeout(10_000),
    });
    const tj = (await tok.json().catch(() => ({}))) as { id_token?: string };
    if (!tok.ok || !tj.id_token) return void fail("LINE 登入失敗，請再試一次");
    // 由 LINE 驗證 id_token 的簽章、期限、aud（client_id）與 nonce
    const vr = await fetch("https://api.line.me/oauth2/v2.1/verify", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ id_token: tj.id_token, client_id: cfg.channelId, nonce: st.nonce }), signal: AbortSignal.timeout(10_000) });
    const vj = (await vr.json().catch(() => ({}))) as { sub?: string; name?: string; email?: string; iss?: string; aud?: string };
    if (!vr.ok || !vj.sub || vj.iss !== "https://access.line.me" || vj.aud !== cfg.channelId) return void fail("LINE 身分驗證失敗");
    sub = vj.sub;
    name = vj.name ?? null;
    email = vj.email ?? null;
  }
  const idRef = db.collection(C.identities).doc(`line:${sub}`);
  const existing = (await idRef.get()).data();
  let uid: string;
  if (st.linkUid) {
    if (existing && existing.uid !== st.linkUid) return void fail("這個 LINE 帳號已綁定其他會員");
    uid = st.linkUid as string;
  } else uid = (existing?.uid as string) ?? `line-${sub}`.slice(0, 120);
  await idRef.set({ uid, provider: "line", sub, linkedAt: existing?.linkedAt ?? new Date().toISOString() });
  const cref = db.collection(C.shopCustomers).doc(uid);
  const c = (await cref.get()).data() ?? {};
  await cref.set({ providers: [...new Set([...((c.providers as string[]) ?? []), "line"])], name: c.name || name || "", contactEmail: c.contactEmail || email || "", lineEmail: email, updatedAt: new Date().toISOString(), ...(c.createdAt ? {} : { createdAt: new Date().toISOString() }) }, { merge: true });
  const customToken = await getAuth().createCustomToken(uid, { provider: "line" });
  const ticket = b64(randomBytes(32));
  await db.collection(C.loginTickets).doc(sha(ticket)).set({ customToken, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  res.redirect(302, `${site}${st.returnTo}${st.returnTo.includes("?") ? "&" : "?"}ticket=${encodeURIComponent(ticket)}`);
}

/** 已登入會員開始綁定 LINE：發一次性綁定代碼（5 分鐘） */
export async function lineLinkStart(db: Firestore, uid: string) {
  const link = b64(randomBytes(24));
  await db.collection(C.oauthStates).doc(`link-${sha(link)}`).set({ uid, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() });
  return link;
}
