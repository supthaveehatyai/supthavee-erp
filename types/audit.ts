/**
 * Audit Trail types — safe for Client + Server.
 * Do NOT put these in `"use server"` files (Next.js forbids exporting types from them).
 */

import type { Database, Json } from "@/src/types/supabase";

export type AuditActionType = Database["public"]["Enums"]["audit_action_type"];

export type RecentAuditLog = {
  id: string;
  table_name: string;
  /** Thai-friendly table label */
  table_label: string;
  record_id: string;
  action: AuditActionType;
  old_data: Json | null;
  new_data: Json | null;
  /** Human-readable diff summary (parsed from JSONB) */
  change_summary: string;
  changed_by: string | null;
  changed_by_email: string | null;
  /** full_name → email → "ระบบ" (never ISSUE/VOID tokens) */
  changed_by_display: string;
  /** From user_profiles → app_roles.role_name_th when available */
  changed_by_role: string | null;
  ip_address: string | null;
  changed_at: string;
  correlation_id: string | null;
};

export type GetRecentAuditLogsResult = {
  data: RecentAuditLog[];
  error: string | null;
};
