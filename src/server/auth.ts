import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/db";
import type { Actor } from "./domain/audit";

/**
 * 認證（本機帳號 + 資料庫 Session）。
 *  - Session token 為 32 bytes 隨機值，只存 SHA-256 雜湊於資料庫；Cookie 為 HttpOnly / SameSite=Lax / 正式環境 Secure。
 *  - 每個管理頁面（layout）與每個 Server Action / API 都在伺服器端呼叫 requireUser()。
 *  - 未來可替換為 Supabase Auth（見 ARCHITECTURE.md），User 資料表保留 role 以支援權限擴充。
 */
export const SESSION_COOKIE = "ata_session";
const SESSION_DAYS = 7;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000),
      ip: clientIp(h),
      userAgent: h.get("user-agent")?.slice(0, 300),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

export const getCurrentUser = cache(async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!s || s.expiresAt < new Date() || !s.user.isActive) return null;
  // 滑動更新最後使用時間（每 10 分鐘最多一次）
  if (Date.now() - s.lastSeenAt.getTime() > 600_000) {
    await prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  const { passwordHash: _ph, ...user } = s.user;
  void _ph;
  return user;
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireActor(): Promise<Actor> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  if (user.role === "VIEWER") throw new Error("FORBIDDEN");
  const h = await headers();
  return { userId: user.id, ip: clientIp(h) };
}

export function clientIp(h: Headers) {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/** 固定視窗速率限制（資料庫實作，適用多執行個體） */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const now = new Date();
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" (key, count, "resetAt") VALUES (${key}, 1, ${new Date(now.getTime() + windowSec * 1000)})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN "RateLimitBucket"."resetAt" < ${now} THEN 1 ELSE "RateLimitBucket".count + 1 END,
      "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" < ${now} THEN EXCLUDED."resetAt" ELSE "RateLimitBucket"."resetAt" END
    RETURNING count`;
  return rows[0].count <= limit;
}

export async function verifyLogin(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  // 即使帳號不存在也執行 bcrypt，避免以回應時間探測帳號
  const ok = await bcrypt.compare(password, user?.passwordHash ?? "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
  if (!user || !ok || !user.isActive) return null;
  return user;
}

/** 外部 API（未來官網）金鑰驗證：Authorization: Bearer ata_xxx */
export async function verifyApiKey(authHeader: string | null, scope: string) {
  const m = /^Bearer\s+(ata_[A-Za-z0-9_-]{8})([A-Za-z0-9_-]{20,})$/.exec(authHeader ?? "");
  if (!m) return null;
  const key = await prisma.apiKey.findUnique({ where: { keyHash: hashToken(m[1] + m[2]) } });
  if (!key || key.revokedAt || !key.scopes.includes(scope)) return null;
  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  return key;
}

export function generateApiKey() {
  const prefix = "ata_" + randomBytes(6).toString("base64url").slice(0, 8);
  const secret = randomBytes(24).toString("base64url");
  return { full: prefix + secret, prefix, hash: hashToken(prefix + secret) };
}
