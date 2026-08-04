/**
 * Server-only Admin authorization helpers.
 * Zero Client-Side Fetching — never import from Client Components.
 */

import "server-only";

import { createClient, type User } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

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
 * Extract Bearer / Supabase auth cookie access token (server-side only).
 */
async function extractAccessToken(): Promise<string | null> {
  const headerStore = await headers();
  const authorization = headerStore.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    if (token) return token;
  }

  const cookieStore = await cookies();
  for (const cookie of cookieStore.getAll()) {
    const name = cookie.name.toLowerCase();
    if (!name.includes("auth-token") && !name.startsWith("sb-")) continue;

    try {
      const parsed = JSON.parse(cookie.value) as Record<string, unknown>;
      if (typeof parsed.access_token === "string" && parsed.access_token) {
        return parsed.access_token;
      }
    } catch {
      // ignore non-JSON cookies
    }

    try {
      const decoded = Buffer.from(cookie.value, "base64").toString("utf8");
      const parsed = JSON.parse(decoded) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        typeof (parsed as { access_token?: unknown }).access_token === "string"
      ) {
        return (parsed as { access_token: string }).access_token;
      }
      // Chunked cookie format: [access_token, refresh_token, ...]
      if (Array.isArray(parsed) && typeof parsed[0] === "string" && parsed[0]) {
        return parsed[0];
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Enforce Admin-only access for privileged Server Actions (e.g. Manual Backup).
 *
 * Resolution:
 * 1. Valid session + role `admin` OR email ∈ `ADMIN_EMAILS`
 * 2. No Auth UI yet → allow only when `MANUAL_BACKUP_ALLOW_ADMIN=true` (server env)
 */
export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const accessToken = await extractAccessToken();

  if (accessToken && supabaseUrl && anonKey) {
    try {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });

      const {
        data: { user },
        error,
      } = await userClient.auth.getUser(accessToken);

      if (error || !user) {
        return { ok: false, error: "Unauthorized: session ไม่ถูกต้อง" };
      }

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
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Admin authorization failed";
      return { ok: false, error: message };
    }
  }

  // Current ERP shell has no Auth UI yet — explicit server opt-in only
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
