import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const url = req.nextUrl.clone();
  const pathname = url.pathname;
  const protectedPrefixes = ["/dashboard", "/chat", "/prospects", "/admin"];
  const isProtected = protectedPrefixes.some((p) => pathname.startsWith(p));
  if (!isProtected) return res;
  const supabase = createServerClient({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    headers: req.headers,
    cookies: {
      get: (name: string) => req.cookies.get(name)?.value,
      set: () => {},
      remove: () => {},
    },
  });
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    const dest = encodeURIComponent(pathname + (url.search || ""));
    const login = new URL(`/auth/login?redirect=${dest}`, req.url);
    return NextResponse.redirect(login);
  }
  return res;
}

export const config = {
  matcher: ["/dashboard/:path*", "/chat", "/prospects/:path*", "/admin/:path*"],
};