/**
 * Server-only Admin authorization helpers.
 * Zero Client-Side Fetching — never import from Client Components.
 */

import "server-only";

import type { User } from "@supabase/supabase-js";
import { createSupabaseSSRClient } from "@/lib/supabase/ssr-server";

export type AdminContext = {
  userId: string | null;
  email: string | null;
  displayName: string;
};

export type RequireAdminResult =
  | { ok: true; admin: AdminContext }
  | { ok: false; error: string };

function readRole(user: User): string {
  const app = (user.app_metadata ?? {}) as Record<string, unknown>;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return String(
    app.role ?? app.user_role ?? meta.role ?? meta.user_role ?? "",
  ).toLowerCase();
}

function isAdminUser(user: User): boolean {
  if (readRole(user) === "admin") return true;

  const allowlist = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return Boolean(
    user.email && allowlist.includes(user.email.toLowerCase()),
  );
}

/**
 * Enforce Admin-only access for privileged Server Actions (e.g. Manual Backup).
 *
 * Resolution:
 * 1. Valid session + role `admin` OR email ∈ `ADMIN_EMAILS`
 * 2. Bootstrap fallback when `MANUAL_BACKUP_ALLOW_ADMIN=true` (server env)
 */
export async function requireAdmin(): Promise<RequireAdminResult> {
  try {
    const supabase = await createSupabaseSSRClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (!error && user) {
      if (!isAdminUser(user)) {
        return {
          ok: false,
          error: "Forbidden: เฉพาะผู้ใช้สิทธิ์ Admin เท่านั้นที่สำรองข้อมูลได้",
        };
      }

      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const displayName =
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        user.email ||
        "Admin";

      return {
        ok: true,
        admin: {
          userId: user.id,
          email: user.email ?? null,
          displayName,
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
