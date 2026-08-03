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

type AuthUserLookup = {
  email: string | null;
  displayName: string | null;
};

function pickDisplayName(
  meta: Record<string, unknown> | undefined,
): string | null {
  if (!meta) return null;
  const candidates = [
    meta.full_name,
    meta.name,
    meta.display_name,
    meta.fullName,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

async function resolveAuthUsers(
  supabase: ReturnType<typeof createClient>,
  userIds: string[],
): Promise<Map<string, AuthUserLookup>> {
  const map = new Map<string, AuthUserLookup>();
  if (userIds.length === 0) return map;

  await Promise.all(
    userIds.map(async (userId) => {
      try {
        const { data, error } = await supabase.auth.admin.getUserById(userId);
        if (error || !data?.user) {
          map.set(userId, { email: null, displayName: null });
          return;
        }
        map.set(userId, {
          email: data.user.email ?? null,
          displayName: pickDisplayName(
            data.user.user_metadata as Record<string, unknown> | undefined,
          ),
        });
      } catch {
        map.set(userId, { email: null, displayName: null });
      }
    }),
  );

  return map;
}

/**
 * Fetch the 50 most recent audit_logs (newest first).
 * Schema column is `changed_at` (not created_at).
 * Each row includes a parsed change_summary from old_data / new_data JSONB.
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

    const authUsers = await resolveAuthUsers(supabaseAdmin, uniqueUserIds);

    const enriched: RecentAuditLog[] = rows.map((row) => {
      const auth = row.changed_by
        ? authUsers.get(row.changed_by)
        : undefined;
      const email = auth?.email ?? null;
      const changedByName =
        typeof row.changed_by_name === "string" && row.changed_by_name.trim()
          ? row.changed_by_name.trim()
          : null;

      const changed_by_display =
        auth?.displayName ?? email ?? changedByName ?? "SYSTEM";

      return {
        id: row.id,
        table_name: row.table_name,
        table_label: getAuditTableLabel(row.table_name),
        record_id: row.record_id,
        action: row.action,
        old_data: row.old_data,
        new_data: row.new_data,
        change_summary: parseAuditChangeSummary(
          row.action,
          row.old_data,
          row.new_data,
        ),
        changed_by: row.changed_by,
        changed_by_email: email,
        changed_by_display,
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
