/**
 * Resolve the signed-in Auth user on the server (SSR cookies).
 * Server-only — for Server Actions / audit trail, never Client Components.
 */

import "server-only";

import { createSupabaseSSRClient } from "@/lib/supabase/ssr-server";

export type CurrentAuthUser = {
  userId: string;
  email: string | null;
  /** Prefer user_metadata.full_name, then name, then email */
  displayName: string | null;
};

function pickDisplayName(
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
 * Returns the authenticated user from `supabase.auth.getUser()`, or null
 * when there is no valid session (e.g. system / cron / backup without login).
 */
export async function getCurrentAuthUser(): Promise<CurrentAuthUser | null> {
  try {
    const supabase = await createSupabaseSSRClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user?.id) return null;

    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    return {
      userId: user.id,
      email: user.email ?? null,
      displayName: pickDisplayName(meta) ?? user.email ?? null,
    };
  } catch {
    return null;
  }
}
