"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { clientIp, createSession, destroySession, rateLimit, verifyLogin } from "@/server/auth";

export async function loginAction(_prev: { error: string | null }, fd: FormData): Promise<{ error: string | null }> {
  const email = String(fd.get("email") ?? "").toLowerCase().trim();
  const password = String(fd.get("password") ?? "");
  const next = String(fd.get("next") ?? "/");
  const ip = clientIp(await headers()) ?? "local";
  // 速率限制：同 IP 15 分鐘 20 次、同帳號 15 分鐘 8 次
  if (!(await rateLimit(`login:ip:${ip}`, 20, 900)) || !(await rateLimit(`login:email:${email}`, 8, 900))) {
    return { error: "嘗試次數過多，請 15 分鐘後再試" };
  }
  const user = await verifyLogin(email, password);
  if (!user) {
    await prisma.auditLog.create({ data: { action: "auth.loginFailed", entityType: "User", summary: `登入失敗：${email}`, ip } });
    return { error: "電子郵件或密碼錯誤" };
  }
  await createSession(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await prisma.auditLog.create({ data: { actorId: user.id, action: "auth.login", entityType: "User", entityId: user.id, summary: "登入", ip } });
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
