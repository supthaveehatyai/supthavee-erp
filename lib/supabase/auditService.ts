/**
 * Phase 6 — Audit Trail service (server-only).
 *
 * Writes append-only rows to `public.audit_logs` via the Supabase Service Role
 * Key so RLS is bypassed. Call exclusively from Server Actions / Route Handlers
 * — never from Client Components.
 */

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/src/types/supabase";

export type AuditActionType = Database["public"]["Enums"]["audit_action_type"];

export type AuditJson = Json | Record<string, unknown> | unknown[] | null;

export type LogAuditTrailParams = {
  tableName: string;
  recordId: string;
  action: AuditActionType;
  oldData?: AuditJson;
  newData?: AuditJson;
  userId?: string | null;
  ipAddress?: string | null;
  changedByName?: string | null;
  correlationId?: string | null;
};

export type LogAuditTrailResult =
  | { success: true; id: string }
  | { success: false; error: string };

type AdminClient = SupabaseClient<Database>;

function createSupabaseAdminClient(): AdminClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY (หรือ NEXT_PUBLIC_SUPABASE_URL) — ตั้งค่าใน .env.development แล้วรีสตาร์ท next dev",
    );
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function toJsonb(value: AuditJson | undefined): Json | null {
  if (value === undefined || value === null) {
    return null;
  }

  // Supabase Insert expects Database Json; plain objects are structurally compatible.
  return value as Json;
}

/**
 * Insert one audit trail row. Failures are returned — never thrown — so callers
 * can log without aborting the primary business transaction unless they choose to.
 */
export async function logAuditTrail(
  tableName: string,
  recordId: string,
  action: AuditActionType,
  oldData: AuditJson = null,
  newData: AuditJson = null,
  userId: string | null = null,
  options?: {
    ipAddress?: string | null;
    changedByName?: string | null;
    correlationId?: string | null;
  },
): Promise<LogAuditTrailResult> {
  const trimmedTable = tableName.trim();
  const trimmedRecordId = recordId.trim();

  if (!trimmedTable) {
    return { success: false, error: "tableName is required" };
  }
  if (!trimmedRecordId) {
    return { success: false, error: "recordId is required" };
  }
  if (action !== "INSERT" && action !== "UPDATE" && action !== "DELETE") {
    return { success: false, error: `Invalid audit action: ${String(action)}` };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("audit_logs")
      .insert({
        table_name: trimmedTable,
        record_id: trimmedRecordId,
        action,
        old_data: toJsonb(oldData),
        new_data: toJsonb(newData),
        changed_by: userId,
        ip_address: options?.ipAddress ?? null,
        changed_by_name: options?.changedByName ?? null,
        correlation_id: options?.correlationId ?? null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[logAuditTrail] insert failed:", error.message);
      return { success: false, error: error.message };
    }

    if (!data?.id) {
      return { success: false, error: "audit_logs insert returned no id" };
    }

    return { success: true, id: data.id };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unexpected audit logging failure";
    console.error("[logAuditTrail]", message);
    return { success: false, error: message };
  }
}

/**
 * Object-style overload for Server Actions that prefer a single params bag.
 */
export async function logAuditTrailFromParams(
  params: LogAuditTrailParams,
): Promise<LogAuditTrailResult> {
  return logAuditTrail(
    params.tableName,
    params.recordId,
    params.action,
    params.oldData ?? null,
    params.newData ?? null,
    params.userId ?? null,
    {
      ipAddress: params.ipAddress,
      changedByName: params.changedByName,
      correlationId: params.correlationId,
    },
  );
}
