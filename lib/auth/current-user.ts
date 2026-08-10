/**
 * Resolve the signed-in Auth user on the server (SSR cookies).
 * Server-only — for Server Actions / audit trail / Layout, never Client Components.
 *
 * Display name priority: `user_profiles.full_name` → JWT metadata → email.
 */

import "server-only";

import { createClient as createAdminClient } from "@/lib/supabase/server-admin";
import { createSupabaseSSRClient } from "@/lib/supabase/ssr-server";

export type CurrentAuthUser = {
  userId: string;
  email: string | null;
  /** Prefer user_profiles.full_name, then metadata, then email */
  displayName: string | null;
  roleCode: string | null;
};

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
 * `user_profiles` when available. Returns null when there is no valid session.
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

    try {
      const admin = createAdminClient();
      const { data: profile } = await admin
        .from("user_profiles")
        .select("full_name, email, role_code")
        .eq("id", user.id)
        .maybeSingle();

      if (profile) {
        const name = String(profile.full_name ?? "").trim();
        profileFullName = name || null;
        profileEmail = String(profile.email ?? "").trim() || null;
        roleCode = String(profile.role_code ?? "").trim() || null;
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
    };
  } catch {
    return null;
  }
}
