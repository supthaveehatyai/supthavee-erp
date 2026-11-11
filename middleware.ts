/**
 * Auth Middleware / Guard (Zero Client-Side Fetching).
 *
 * Note: Next.js 16 renames this convention to `proxy.ts`. This project keeps
 * `middleware.ts` as requested for Auth Guard semantics; the runtime still
 * supports it (edge-compatible session refresh via @supabase/ssr).
 */

import { NextResponse, type NextRequest } from "next/server";
import { isAuthPath } from "@/lib/auth/module-access";
import { updateSession } from "@/lib/supabase/update-session";

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/line")) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (isAuthPath(pathname)) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pathname", pathname);
    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  }

  if (isPrefetchWithSession(request)) {
    return NextResponse.next();
  }

  return updateSession(request);
}

function isPrefetchWithSession(request: NextRequest): boolean {
  const purpose = (request.headers.get("purpose") ?? request.headers.get("x-purpose") ?? "")
    .trim()
    .toLowerCase();
  const prefetchHeader = request.headers.get("x-middleware-prefetch")
    ?? request.headers.get("next-router-prefetch");
  const isPrefetch = purpose === "prefetch" || prefetchHeader === "1";
  if (!isPrefetch) return false;
  return request.cookies.getAll().some((cookie) => {
    const name = cookie.name.toLowerCase();
    return name.startsWith("sb-") && name.includes("auth-token") && cookie.value.length > 0;
  });
}

export const config = {
  matcher: [
    /*
     * Match all paths except Next.js internals and static assets.
     * Auth cookies are refreshed on every matched navigation.
     */
    "/((?!_next/static|_next/image|_next/data|favicon.ico|api/line|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot)$).*)",
  ],
};
