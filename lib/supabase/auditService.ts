/**
 * Phase 6 — Audit Trail service (server-only).
 *
 * Writes append-only rows to `public.audit_logs` via the Supabase Service Role
 * Key so RLS is bypassed. Call exclusively from Server Actions / Route Handlers
 * — never from Client Components.
 *
 * Security: `changed_by` is ALWAYS resolved via server-side
 * `supabase.auth.getUser()` (`getCurrentAuthUser`). Caller-supplied user IDs
 * are ignored to prevent client spoofing.
 */

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import type { Database, Json } from "@/src/types/supabase";

export type AuditActionType = Database["public"]["Enums"]["audit_action_type"];

export type AuditJson = Json | Record<string, unknown> | unknown[] | null;

export type LogAuditTrailParams = {
  tableName: string;
  recordId: string;
  action: AuditActionType;
  oldData?: AuditJson;
  newData?: AuditJson;
  /**
   * @deprecated Ignored — actor is resolved server-side via auth.getUser().
   * Kept for call-site compatibility only.
   */
  userId?: string | null;
  ipAddress?: string | null;
  /**
   * @deprecated Ignored for identity — display name comes from the Auth session.
   * Kept for call-site compatibility only.
   */
  changedByName?: string | null;
  correlationId?: string | null;
};

export type LogAuditTrailResult =
  | { success: true; id: string }
  | { success: false; error: string };

type AdminClient = SupabaseClient<Database>;

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  return value as Json;
}

/** Guardrail: only persist real Auth user UUIDs (never action labels). */
function sanitizeUserId(userId: string | null | undefined): string | null {
  if (typeof userId !== "string") return null;
  const trimmed = userId.trim();
  if (!trimmed || !UUID_RE.test(trimmed)) return null;
  return trimmed;
}

/** Guardrail: never store ISSUE/VOID/etc. in changed_by_name. */
function sanitizeChangedByName(
  name: string | null | undefined,
): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (ACTION_NAME_TOKENS.has(trimmed.toUpperCase())) return null;
  return trimmed.slice(0, 100);
}

/**
 * Insert one audit trail row.
 * Actor (`changed_by`) is resolved from the current Auth session only.
 * Failures are returned — never thrown — so callers can log without aborting
 * the primary business transaction unless they choose to.
 */
export async function logAuditTrail(
  tableName: string,
  recordId: string,
  action: AuditActionType,
  oldData: AuditJson = null,
  newData: AuditJson = null,
  /** @deprecated Ignored — use Auth session only */
  _userIdFromCaller: string | null = null,
  options?: {
    ipAddress?: string | null;
    /** @deprecated Ignored — use Auth session only */
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
    // Always resolve actor server-side — never trust caller / client userId.
    const actor = await getCurrentAuthUser();
    const safeUserId = sanitizeUserId(actor?.userId ?? null);
    const safeChangedByName = sanitizeChangedByName(
      actor?.displayName ?? actor?.email ?? null,
    );

    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("audit_logs")
      .insert({
        table_name: trimmedTable,
        record_id: trimmedRecordId,
        action,
        old_data: toJsonb(oldData),
        new_data: toJsonb(newData),
        changed_by: safeUserId,
        ip_address: options?.ipAddress ?? null,
        changed_by_name: safeChangedByName,
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
 * Alias: {@link insertAuditLog}
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
    null,
    {
      ipAddress: params.ipAddress,
      correlationId: params.correlationId,
    },
  );
}

/**
 * Preferred name for Server Actions — inserts one audit row with
 * server-resolved Auth actor (`changed_by`).
 */
export async function insertAuditLog(
  params: LogAuditTrailParams,
): Promise<LogAuditTrailResult> {
  return logAuditTrailFromParams(params);
}
