/**
 * Server-only Admin authorization helpers.
 * Zero Client-Side Fetching — never import from Client Components.
 *
 * Source of truth for role: `user_profiles.role_code` (case-insensitive),
 * with JWT metadata / ADMIN_EMAILS as secondary checks.
 */

import "server-only";

import type { User } from "@supabase/supabase-js";
import { createClient as createAdminClient } from "@/lib/supabase/server-admin";
import { createSupabaseSSRClient } from "@/lib/supabase/ssr-server";

export type AdminContext = {
  userId: string | null;
  email: string | null;
  displayName: string;
};

export type RequireAdminResult =
  | { ok: true; admin: AdminContext }
  | { ok: false; error: string };

export type RequireAdminOptions = {
  /** Override message when signed-in but not Admin */
  forbiddenMessage?: string;
};

const DEFAULT_FORBIDDEN =
  "Forbidden: เฉพาะผู้ใช้สิทธิ์ Admin เท่านั้น";

type ProfileGateRow = {
  role_code: string | null;
  full_name: string | null;
  email: string | null;
  is_active: boolean | null;
};

function normalizeRole(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isAdminRole(value: unknown): boolean {
  return normalizeRole(value) === "admin";
}

function readJwtRole(user: User): string {
  const app = (user.app_metadata ?? {}) as Record<string, unknown>;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return normalizeRole(
    app.role_code ??
      app.role ??
      app.user_role ??
      meta.role_code ??
      meta.role ??
      meta.user_role ??
      "",
  );
}

function isEmailAllowlisted(user: User): boolean {
  const allowlist = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return Boolean(
    user.email && allowlist.includes(user.email.toLowerCase()),
  );
}

async function loadUserProfile(userId: string): Promise<ProfileGateRow | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("user_profiles")
      .select("role_code, full_name, email, is_active")
      .eq("id", userId)
      .maybeSingle();

    if (error || !data) return null;
    return data as ProfileGateRow;
  } catch {
    return null;
  }
}

function resolveDisplayName(
  user: User,
  profile: ProfileGateRow | null,
): string {
  const fromProfile = profile?.full_name?.trim();
  if (fromProfile) return fromProfile;

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  for (const key of ["full_name", "name", "display_name", "fullName"] as const) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return (
    profile?.email?.trim() ||
    user.email?.trim() ||
    "Admin"
  );
}

function isAdminUser(user: User, profile: ProfileGateRow | null): boolean {
  if (profile && profile.is_active === false) return false;

  if (isAdminRole(profile?.role_code)) return true;
  if (isAdminRole(readJwtRole(user))) return true;
  if (isEmailAllowlisted(user)) return true;

  return false;
}

/**
 * Enforce Admin-only access for privileged Server Actions.
 *
 * Resolution:
 * 1. Valid session + (`user_profiles.role_code` = admin OR JWT role OR ADMIN_EMAILS)
 * 2. Bootstrap fallback when `MANUAL_BACKUP_ALLOW_ADMIN=true` (server env)
 */
export async function requireAdmin(
  options?: RequireAdminOptions,
): Promise<RequireAdminResult> {
  const forbiddenMessage = options?.forbiddenMessage ?? DEFAULT_FORBIDDEN;

  try {
    const supabase = await createSupabaseSSRClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (!error && user) {
      const profile = await loadUserProfile(user.id);

      if (!isAdminUser(user, profile)) {
        return {
          ok: false,
          error: forbiddenMessage,
        };
      }

      return {
        ok: true,
        admin: {
          userId: user.id,
          email: user.email ?? profile?.email ?? null,
          displayName: resolveDisplayName(user, profile),
        },
      };
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Admin authorization failed";
    if (process.env.MANUAL_BACKUP_ALLOW_ADMIN !== "true") {
      return { ok: false, error: message };
    }
  }

  if (process.env.MANUAL_BACKUP_ALLOW_ADMIN === "true") {
    return {
      ok: true,
      admin: {
        userId: null,
        email: null,
        displayName: "Admin",
      },
    };
  }

  return {
    ok: false,
    error:
      "Forbidden: ต้องเข้าสู่ระบบด้วยบัญชี Admin หรือตั้ง MANUAL_BACKUP_ALLOW_ADMIN=true ใน .env.production",
  };
}
