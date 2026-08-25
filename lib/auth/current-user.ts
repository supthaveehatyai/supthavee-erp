/**
 * Resolve the signed-in Auth user on the server (SSR cookies).
 * Server-only — for Server Actions / audit trail / Layout, never Client Components.
 *
 * Display name priority: `user_profiles.full_name` → JWT metadata → email.
 */

import "server-only";

import { parseAccessibleModules } from "@/lib/auth/module-access";
import { createClient as createAdminClient } from "@/lib/supabase/server-admin";
import { createSupabaseSSRClient } from "@/lib/supabase/ssr-server";
import type { AccessibleModules } from "@/types/rbac";

export type CurrentAuthUser = {
  userId: string;
  email: string | null;
  /** Prefer user_profiles.full_name, then metadata, then email */
  displayName: string | null;
  roleCode: string | null;
  /** From `app_roles.accessible_modules` for the user's role_code */
  accessibleModules: AccessibleModules;
};

type RoleModulesJoin =
  | { accessible_modules: unknown }
  | { accessible_modules: unknown }[]
  | null;

function unwrapRoleModules(join: RoleModulesJoin): unknown {
  if (!join) return null;
  if (Array.isArray(join)) return join[0]?.accessible_modules ?? null;
  return join.accessible_modules ?? null;
}

function pickMetaDisplayName(
  meta: Record<string, unknown> | undefined,
): string | null {
  if (!meta) return null;
  for (const key of ["full_name", "name", "display_name", "fullName"] as const) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Returns the authenticated user from `supabase.auth.getUser()`, enriched with
 * `user_profiles` + `app_roles.accessible_modules` when available.
 * Returns null when there is no valid session.
 */
export async function getCurrentAuthUser(): Promise<CurrentAuthUser | null> {
  try {
    const supabase = await createSupabaseSSRClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user?.id) return null;

    let profileFullName: string | null = null;
    let profileEmail: string | null = null;
    let roleCode: string | null = null;
    let accessibleModules = parseAccessibleModules(null, null);

    try {
      const admin = createAdminClient();
      const { data: profile } = await admin
        .from("user_profiles")
        .select(
          `
          full_name,
          email,
          role_code,
          app_roles (
            accessible_modules
          )
        `,
        )
        .eq("id", user.id)
        .maybeSingle();

      if (profile) {
        const name = String(profile.full_name ?? "").trim();
        profileFullName = name || null;
        profileEmail = String(profile.email ?? "").trim() || null;
        roleCode = String(profile.role_code ?? "").trim() || null;
        accessibleModules = parseAccessibleModules(
          unwrapRoleModules(profile.app_roles as RoleModulesJoin),
          roleCode,
        );
      }
    } catch {
      // Profile lookup is best-effort — Auth session still valid.
    }

    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const displayName =
      profileFullName ||
      pickMetaDisplayName(meta) ||
      profileEmail ||
      user.email ||
      null;

    return {
      userId: user.id,
      email: user.email ?? profileEmail,
      displayName,
      roleCode,
      accessibleModules,
    };
  } catch {
    return null;
  }
}

export type RequireSessionUserIdResult =
  | { ok: true; userId: string }
  | { ok: false; error: string };

/**
 * บังคับมี Auth Session — ใช้ stamp `documents.created_by` ตอนสร้างเอกสารใหม่
 */
export async function requireSessionUserId(): Promise<RequireSessionUserIdResult> {
  const actor = await getCurrentAuthUser();
  if (!actor?.userId) {
    return {
      ok: false,
      error: "กรุณาเข้าสู่ระบบก่อนบันทึกเอกสาร",
    };
  }
  return { ok: true, userId: actor.userId };
}
