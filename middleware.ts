/**
 * Auth Middleware / Guard (Zero Client-Side Fetching).
 *
 * Note: Next.js 16 renames this convention to `proxy.ts`. This project keeps
 * `middleware.ts` as requested for Auth Guard semantics; the runtime still
 * supports it (edge-compatible session refresh via @supabase/ssr).
 */

import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/update-session";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all paths except Next static assets / common image files.
     * Auth cookies are refreshed on every matched navigation.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
