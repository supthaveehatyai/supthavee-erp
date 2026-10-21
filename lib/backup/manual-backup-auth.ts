/**
 * Manual backup authorization — Admin หรือโมดูล settings
 * ใช้ร่วมกันระหว่าง Server Action และ GET /api/backup/export
 */

import {
  isAdminRoleCode,
  parseAccessibleModules,
} from "@/lib/auth/module-access";
import { createClient as createSupabaseAdmin } from "@/lib/supabase/server-admin";
import { createSupabaseSSRClient } from "@/lib/supabase/ssr-server";

type RoleModulesJoin =
  | { accessible_modules: unknown }
  | { accessible_modules: unknown }[]
  | null;

function unwrapRoleModules(join: RoleModulesJoin): unknown {
  if (!join) return null;
  if (Array.isArray(join)) return join[0]?.accessible_modules ?? null;
  return join.accessible_modules ?? null;
}

export type ManualBackupAuthSuccess = {
  ok: true;
  userId: string;
};

export type ManualBackupAuthFailure = {
  ok: false;
  error: string;
};

/**
 * 1) Auth Session → user.id
 * 2) user_profiles ⋈ app_roles (Service Role)
 * 3) Allow when role is Admin OR accessible_modules.settings === true
 */
export async function resolveManualBackupAuth(): Promise<
  ManualBackupAuthSuccess | ManualBackupAuthFailure
> {
  const supabaseAuth = await createSupabaseSSRClient();
  const {
    data: { user },
    error: authError,
  } = await supabaseAuth.auth.getUser();

  if (authError || !user?.id) {
    return { ok: false, error: "Forbidden" };
  }

  const supabaseAdmin = createSupabaseAdmin();
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("user_profiles")
    .select(
      `
      id,
      full_name,
      email,
      role_code,
      is_active,
      app_roles!user_profiles_role_code_fkey (
        accessible_modules
      )
    `,
    )
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return { ok: false, error: "Forbidden" };
  }

  if (profile.is_active === false) {
    return { ok: false, error: "Forbidden" };
  }

  const roleCode =
    typeof profile.role_code === "string" && profile.role_code.trim()
      ? profile.role_code.trim()
      : null;

  const modules = parseAccessibleModules(
    unwrapRoleModules(profile.app_roles as RoleModulesJoin),
    roleCode,
  );

  const isHighLevelAdmin = isAdminRoleCode(roleCode);
  const canAccessSettings = modules.settings === true;

  if (!isHighLevelAdmin && !canAccessSettings) {
    return { ok: false, error: "Forbidden" };
  }

  return { ok: true, userId: user.id };
}
