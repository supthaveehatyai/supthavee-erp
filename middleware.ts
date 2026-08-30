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
  const { pathname } = request.nextUrl;

  if (isAuthPath(pathname)) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pathname", pathname);
    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all paths except Next.js internals and static assets.
     * Auth cookies are refreshed on every matched navigation.
     */
    "/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot)$).*)",
  ],
};
