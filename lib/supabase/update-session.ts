/**
 * Auth session refresh + route guard for Next.js Proxy (ex-middleware).
 * Zero Client-Side Fetching — session from cookies via @supabase/ssr.
 */

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  canAccessPath,
  isAuthPath,
  parseAccessibleModules,
} from "@/lib/auth/module-access";

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|woff2?)$/i.test(pathname)
  );
}

/**
 * Refresh Auth cookies and enforce Auth Guard for ERP routes.
 * Returns a NextResponse that must be returned from `proxy` / middleware.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    // Misconfigured env — do not lock the whole app; let pages surface the error.
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({
          request: { headers: requestHeaders },
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([key, value]) => {
          supabaseResponse.headers.set(key, value);
        });
      },
    },
  });

  // Validate session with Auth server (do not use getSession() alone).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (isStaticAsset(pathname)) {
    return supabaseResponse;
  }

  const onAuthPage = isAuthPath(pathname);

  if (!user && !onAuthPage) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && !onAuthPage) {
    const denied = await isModuleAccessDenied(pathname, user.id);
    if (denied) {
      const forbiddenUrl = request.nextUrl.clone();
      forbiddenUrl.pathname = "/forbidden";
      forbiddenUrl.search = "";
      forbiddenUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(forbiddenUrl);
    }
  }

  return supabaseResponse;
}

type RoleModulesJoin =
  | { accessible_modules: unknown }
  | { accessible_modules: unknown }[]
  | null;

function unwrapRoleModules(join: RoleModulesJoin): unknown {
  if (!join) return null;
  if (Array.isArray(join)) return join[0]?.accessible_modules ?? null;
  return join.accessible_modules ?? null;
}

/**
 * Module AuthGuard — Service Role lookup of app_roles.accessible_modules.
 * Fail-open when Service Role is missing so login still works.
 */
async function isModuleAccessDenied(
  pathname: string,
  userId: string,
): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return false;

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data: profile, error } = await admin
      .from("user_profiles")
      .select("role_code, app_roles ( accessible_modules )")
      .eq("id", userId)
      .maybeSingle();

    if (error || !profile) return false;

    const roleCode = String(profile.role_code ?? "").trim() || null;
    const modules = parseAccessibleModules(
      unwrapRoleModules(profile.app_roles as RoleModulesJoin),
      roleCode,
    );

    return !canAccessPath(pathname, modules, roleCode);
  } catch {
    return false;
  }
}
