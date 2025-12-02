import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
 

export async function proxy(req: NextRequest) {
  if (process.env.NODE_ENV === "development") {
    return NextResponse.next();
  }
  const res = NextResponse.next();
  const url = req.nextUrl.clone();
  const pathname = url.pathname;
  const protectedPrefixes = ["/dashboard", "/chat", "/prospects", "/admin"];
  const isProtected = protectedPrefixes.some((p) => pathname.startsWith(p));
  if (!isProtected) return res;
  const access = req.cookies.get("sb-access-token")?.value || "";
  const session = access ? { access_token: access } : null;
  if (!session) {
    const dest = encodeURIComponent(pathname + (url.search || ""));
    const login = new URL(`/auth/login?next=${dest}`, req.url);
    return NextResponse.redirect(login);
  }
  return res;
}

export const config = {
  matcher: ["/dashboard/:path*", "/chat", "/prospects/:path*", "/admin/:path*"],
};
