import "server-only";

import { redirect } from "next/navigation";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { SUPER_ADMIN_FULL_NAME } from "@/types/holding";
import { isSchemaUnavailable, schemaAdmin } from "@/lib/holding/schema-db";

function nameMatches(fullName?: string | null): boolean {
  return fullName?.trim() === SUPER_ADMIN_FULL_NAME;
}

export async function getSuperAdminStatus(
  userId: string,
  fullName?: string | null,
): Promise<boolean> {
  let resolvedName = fullName ?? null;
  try {
    const admin = schemaAdmin();
    if (!resolvedName) {
      const profile = await admin
        .from("user_profiles")
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();
      const row = profile.data as { full_name?: string | null } | null;
      resolvedName = row?.full_name ?? null;
    }

    const grant = await admin
      .schema("holding")
      .from("user_workspace_grants")
      .select("is_super_admin")
      .eq("user_id", userId)
      .eq("is_super_admin", true)
      .maybeSingle();

    if (grant.error) {
      if (isSchemaUnavailable(grant.error) || nameMatches(resolvedName)) {
        return nameMatches(resolvedName);
      }
      return false;
    }
    if ((grant.data as { is_super_admin?: boolean } | null)?.is_super_admin === true) {
      return true;
    }
    return nameMatches(resolvedName);
  } catch {
    return nameMatches(resolvedName);
  }
}

export async function requireSuperAdmin(): Promise<{ userId: string }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) redirect("/login");
  const allowed = await getSuperAdminStatus(owner.userId);
  if (!allowed) redirect("/forbidden");
  return { userId: owner.userId };
}
