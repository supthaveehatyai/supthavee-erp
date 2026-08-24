"use server";

/**
 * Phase 8 — System Audit Trail Server Actions.
 * Zero Client-Side Fetching: Service Role only.
 * Types live in `@/types/audit` (never export types from this file).
 */

import { createClient } from "@/lib/supabase/server-admin";
import {
  getAuditTableLabel,
  parseAuditChangeSummary,
} from "@/lib/audit/parse-audit-change";
import type {
  GetRecentAuditLogsResult,
  RecentAuditLog,
} from "@/types/audit";

/** Tokens wrongly stored in `changed_by_name` historically — not person names. */
const ACTION_NAME_TOKENS = new Set([
  "ISSUE",
  "VOID",
  "UPDATE",
  "DELETE",
  "INSERT",
  "CREATE",
  "COMPLETE",
  "CANCEL",
  "SYSTEM",
  "CONVERT",
  "DUPLICATE",
  "CLONE",
]);

type ProfileLookup = {
  full_name: string | null;
  email: string | null;
  role_name_th: string | null;
};

type AppRoleEmbed = { role_name_th: string | null } | { role_name_th: string | null }[] | null;

type UserProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  app_roles: AppRoleEmbed;
};

function unwrapRole(embed: AppRoleEmbed): string | null {
  if (!embed) return null;
  const row = Array.isArray(embed) ? embed[0] : embed;
  const name = row?.role_name_th;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function isActionToken(value: string | null | undefined): boolean {
  if (!value) return false;
  return ACTION_NAME_TOKENS.has(value.trim().toUpperCase());
}

function resolveDisplayName(params: {
  profile: ProfileLookup | undefined;
  changedByName: string | null;
}): { display: string; email: string | null; role: string | null } {
  const fullName = params.profile?.full_name?.trim() || null;
  const email = params.profile?.email?.trim() || null;
  const role = params.profile?.role_name_th?.trim() || null;

  if (fullName) {
    return { display: fullName, email, role };
  }
  if (email) {
    return { display: email, email, role };
  }

  // Legacy rows may have a real name in changed_by_name — ignore ISSUE/VOID tokens.
  const legacy = params.changedByName?.trim() || null;
  if (legacy && !isActionToken(legacy)) {
    return { display: legacy, email: null, role };
  }

  return { display: "ระบบ", email: null, role: null };
}

/**
 * Batch-load user_profiles (+ app_roles) for audit `changed_by` UUIDs.
 * Prefer this over PostgREST embed: audit_logs.changed_by FK → auth.users, not user_profiles.
 */
async function resolveUserProfiles(
  supabase: ReturnType<typeof createClient>,
  userIds: string[],
): Promise<Map<string, ProfileLookup>> {
  const map = new Map<string, ProfileLookup>();
  if (userIds.length === 0) return map;

  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, full_name, email, app_roles(role_name_th)")
    .in("id", userIds);

  if (error) {
    console.error("[getRecentAuditLogs] user_profiles lookup:", error.message);
    return map;
  }

  for (const row of (data ?? []) as UserProfileRow[]) {
    map.set(row.id, {
      full_name: row.full_name,
      email: row.email,
      role_name_th: unwrapRole(row.app_roles),
    });
  }

  return map;
}

/**
 * Fetch the 50 most recent audit_logs (newest first).
 * Actor display resolved from `user_profiles` (full_name → email → ระบบ).
 */
export async function getRecentAuditLogs(): Promise<GetRecentAuditLogsResult> {
  try {
    const supabaseAdmin = createClient();

    const { data, error } = await supabaseAdmin
      .from("audit_logs")
      .select(
        "id, table_name, record_id, action, old_data, new_data, changed_by, changed_by_name, ip_address, changed_at, correlation_id",
      )
      .order("changed_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[getRecentAuditLogs]", error.message);
      return { data: [], error: error.message };
    }

    const rows = data ?? [];
    const uniqueUserIds = [
      ...new Set(
        rows
          .map((row) => row.changed_by)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];

    const profiles = await resolveUserProfiles(supabaseAdmin, uniqueUserIds);

    const enriched: RecentAuditLog[] = rows.map((row) => {
      const profile = row.changed_by
        ? profiles.get(row.changed_by)
        : undefined;
      const changedByName =
        typeof row.changed_by_name === "string" && row.changed_by_name.trim()
          ? row.changed_by_name.trim()
          : null;

      const resolved = resolveDisplayName({
        profile,
        changedByName,
      });

      // Surface legacy ISSUE/VOID tokens in the change summary, not the user column.
      let change_summary = parseAuditChangeSummary(
        row.action,
        row.old_data,
        row.new_data,
        4,
        row.table_name,
      );
      if (changedByName && isActionToken(changedByName)) {
        const token = changedByName.toUpperCase();
        if (!change_summary.includes(token)) {
          change_summary = `${token} · ${change_summary}`;
        }
      }

      return {
        id: row.id,
        table_name: row.table_name,
        table_label: getAuditTableLabel(row.table_name),
        record_id: row.record_id,
        action: row.action,
        old_data: row.old_data,
        new_data: row.new_data,
        change_summary,
        changed_by: row.changed_by,
        changed_by_email: resolved.email,
        changed_by_display: resolved.display,
        changed_by_role: resolved.role,
        ip_address: row.ip_address,
        changed_at: row.changed_at,
        correlation_id: row.correlation_id,
      };
    });

    return { data: enriched, error: null };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to load recent audit logs";
    console.error("[getRecentAuditLogs]", message);
    return { data: [], error: message };
  }
}
