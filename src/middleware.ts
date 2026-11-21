import { NextResponse, type NextRequest } from "next/server";

/**
 * 第一道防線（Edge）：未帶 Session Cookie 的管理頁導向登入；
 * 跨站的狀態變更請求（POST/PUT/PATCH/DELETE）拒絕（CSRF 防護，Server Actions 另有 Next.js 內建 Origin 檢查）。
 * 真正的 Session 驗證在伺服器端 requireUser() / requireActor() 完成。
 */
const PUBLIC = [/^\/login/, /^\/t\//, /^\/api\/health/, /^\/api\/storefront\//, /^\/_next\//, /^\/favicon/, /^\/brand\//];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !pathname.startsWith("/api/storefront/")) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (origin && host && new URL(origin).host !== host) {
      return new NextResponse("跨站請求已拒絕", { status: 403 });
    }
  }

  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  if (!req.cookies.get("ata_session")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "未登入" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
