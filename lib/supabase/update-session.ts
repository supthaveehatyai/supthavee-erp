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
  isHoldingWorkspacePath,
  isLiffPath,
  isPublicLineWebhookPath,
  normalizePathname,
  parseAccessibleModules,
  prefersProductionKanbanHome,
} from "@/lib/auth/module-access";
import { accessRedirect, canOpenSupthaveeUsers, isSupthaveeErpPath, parseAccessPayload } from "@/lib/holding/access-routes";
import { SUPER_ADMIN_FULL_NAME, type UserAccessContext } from "@/types/holding";

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

  if (isStaticAsset(pathname) || isPublicLineWebhookPath(pathname)) {
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
    const context = await loadAccessContext(user.id);
    if (context) {
      const target = accessRedirect(pathname, context);
      const targetPath = target?.split("?")[0] ?? "";
      if (target && normalizePathname(targetPath) !== normalizePathname(pathname)) {
        const nextUrl = request.nextUrl.clone();
        const [nextPath, nextQuery] = target.split("?");
        nextUrl.pathname = nextPath || "/forbidden";
        nextUrl.search = nextQuery ? `?${nextQuery}` : "";
        return NextResponse.redirect(nextUrl);
      }
    } else if (isHoldingWorkspacePath(pathname) || isLiffPath(pathname)) {
      const superAdmin = await loadSuperAdminFlag(user.id);
      if (!superAdmin) {
        const forbiddenUrl = request.nextUrl.clone();
        forbiddenUrl.pathname = "/forbidden";
        forbiddenUrl.search = "";
        forbiddenUrl.searchParams.set("from", pathname);
        return NextResponse.redirect(forbiddenUrl);
      }
    }
    const access = await loadModuleAccess(user.id);
    if (access && (!context || isSupthaveeErpPath(pathname))) {
      const path = normalizePathname(pathname);
      const sendToKanban =
        prefersProductionKanbanHome(access.roleCode, access.modules) &&
        (path === "/" || path === "/dashboard");
      if (sendToKanban) {
        const kanbanUrl = request.nextUrl.clone();
        kanbanUrl.pathname = "/production/kanban";
        kanbanUrl.search = "";
        return NextResponse.redirect(kanbanUrl);
      }
      if (
        !isHoldingWorkspacePath(pathname) &&
        !canAccessPath(pathname, access.modules, access.roleCode) &&
        !(context && canOpenSupthaveeUsers(pathname, context, access.roleCode))
      ) {
        const forbiddenUrl = request.nextUrl.clone();
        forbiddenUrl.pathname = "/forbidden";
        forbiddenUrl.search = "";
        forbiddenUrl.searchParams.set("from", pathname);
        return NextResponse.redirect(forbiddenUrl);
      }
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
async function loadModuleAccess(userId: string): Promise<{
  roleCode: string | null;
  modules: ReturnType<typeof parseAccessibleModules>;
} | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;

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

    if (error || !profile) return null;

    const roleCode = String(profile.role_code ?? "").trim() || null;
    const modules = parseAccessibleModules(
      unwrapRoleModules(profile.app_roles as RoleModulesJoin),
      roleCode,
    );

    return { roleCode, modules };
  } catch {
    return null;
  }
}

async function loadAccessContext(userId: string): Promise<UserAccessContext | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await admin.schema("holding").rpc("get_user_access_context", { p_user_id: userId });
    if (error || !data) return null;
    return parseAccessPayload(data);
  } catch {
    return null;
  }
}

async function loadSuperAdminFlag(userId: string): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return false;
  let fullName = "";
  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const profile = await admin
      .from("user_profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    fullName = String(profile.data?.full_name ?? "").trim();
    const grant = await admin
      .schema("holding")
      .from("user_workspace_grants")
      .select("is_super_admin")
      .eq("user_id", userId)
      .eq("is_super_admin", true)
      .maybeSingle();
    const grantRow = grant.data as { is_super_admin?: boolean } | null;
    if (!grant.error && grantRow?.is_super_admin === true) return true;
    const schemaMissing =
      grant.error?.code === "PGRST106" ||
      /PGRST106|invalid schema|schema must be one of/i.test(grant.error?.message ?? "");
    if (schemaMissing || !grantRow) return fullName === SUPER_ADMIN_FULL_NAME;
    return false;
  } catch {
    return fullName === SUPER_ADMIN_FULL_NAME;
  }
}
