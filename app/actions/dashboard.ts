"use server";

/**
 * Phase 6 — Executive Dashboard Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/src/types/supabase";

export type AuditActionType = Database["public"]["Enums"]["audit_action_type"];

export type RecentAuditLog = {
  id: string;
  table_name: string;
  record_id: string;
  action: AuditActionType;
  old_data: Json | null;
  new_data: Json | null;
  changed_by: string | null;
  /** Resolved from auth.users.email (fallback: changed_by_name / SYSTEM) */
  changed_by_email: string | null;
  /** Display label: name metadata → email → changed_by_name → SYSTEM */
  changed_by_display: string;
  ip_address: string | null;
  changed_at: string;
  correlation_id: string | null;
};

export type GetRecentAuditLogsResult = {
  data: RecentAuditLog[];
  error: string | null;
};

/** Money KPI result — amount is always a finite number (0 on error/empty). */
export type KpiMoneyResult = {
  amount: number;
  error: string | null;
};

type AdminClient = SupabaseClient<Database>;

type AuthUserLookup = {
  email: string | null;
  displayName: string | null;
};

type OutstandingDocRow = {
  id: string;
  grand_total: number | string | null;
  paid_amount: number | string | null;
  status: string | null;
  payment_status: string | null;
};

type SalesDocRow = {
  grand_total: number | string | null;
};

const YTD_SALES_DOC_TYPES = ["INV_DO", "TAX_INV", "ABB"] as const;
const AR_PENDING_DOC_TYPES = ["INV_DO", "TAX_INV"] as const;
const AP_PENDING_DOC_TYPES = ["AP_INV", "AP_TAX"] as const;

/**
 * Outstanding filter intent: status IN ('ISSUED', 'PARTIAL').
 * In this schema `PARTIAL` lives on `payment_status` (not document_status enum),
 * so we match: status = ISSUED OR payment_status = PARTIAL.
 */
const OUTSTANDING_STATUS_OR =
  "status.eq.ISSUED,payment_status.eq.PARTIAL" as const;

/**
 * Raw service-role client — bypasses RLS.
 * Never falls back to anon / SSR cookie clients.
 */
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

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function currentYearBounds(): { from: string; to: string; year: number } {
  const year = new Date().getFullYear();
  return {
    year,
    from: `${year}-01-01`,
    to: `${year}-12-31`,
  };
}

/**
 * Σ (grand_total − COALESCE(paid_amount, 0)) for rows with positive remaining.
 */
function sumOutstandingCoalescePaid(rows: OutstandingDocRow[]): number {
  let total = 0;

  for (const row of rows) {
    const remaining = roundMoney(
      toMoney(row.grand_total) - toMoney(row.paid_amount),
    );
    if (remaining > 0) {
      total = roundMoney(total + remaining);
    }
  }

  return total;
}

function pickDisplayName(
  metadata: Record<string, unknown> | undefined,
): string | null {
  if (!metadata) return null;
  const candidates = [
    metadata.full_name,
    metadata.name,
    metadata.display_name,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Resolve auth.users email/name for a set of user IDs via Admin API.
 * PostgREST cannot JOIN `auth.users` from `public` without a DB view —
 * service-role Auth Admin is the supported path.
 */
async function resolveAuthUsers(
  supabaseAdmin: AdminClient,
  userIds: string[],
): Promise<Map<string, AuthUserLookup>> {
  const map = new Map<string, AuthUserLookup>();
  if (userIds.length === 0) return map;

  await Promise.all(
    userIds.map(async (userId) => {
      try {
        const { data, error } =
          await supabaseAdmin.auth.admin.getUserById(userId);
        if (error || !data.user) {
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
 * Fetch the 50 most recent audit_logs rows (newest first),
 * enriching each row with the actor's email/name from auth.users.
 */
export async function getRecentAuditLogs(): Promise<GetRecentAuditLogsResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();

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
        record_id: row.record_id,
        action: row.action,
        old_data: row.old_data,
        new_data: row.new_data,
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

/**
 * Pending AR — INV_DO / TAX_INV where status≈ISSUED or payment_status=PARTIAL.
 * Outstanding = Σ (grand_total − COALESCE(paid_amount, 0)).
 */
export async function getPendingAR(): Promise<KpiMoneyResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("documents")
      .select("id, grand_total, paid_amount, status, payment_status")
      .in("doc_type", [...AR_PENDING_DOC_TYPES])
      .or(OUTSTANDING_STATUS_OR)
      .not("status", "in", '("DRAFT","VOID","CANCELLED")')
      // null/false only — avoid a second .or() which would override status filter
      .not("is_voided", "eq", true);

    if (error) {
      console.error("[getPendingAR]", error.message);
      return { amount: 0, error: error.message };
    }

    return {
      amount: sumOutstandingCoalescePaid((data ?? []) as OutstandingDocRow[]),
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to calculate pending AR";
    console.error("[getPendingAR]", message);
    return { amount: 0, error: message };
  }
}

/**
 * Pending AP — AP_INV / AP_TAX where status≈ISSUED or payment_status=PARTIAL.
 * Outstanding = Σ (grand_total − COALESCE(paid_amount, 0)).
 */
export async function getPendingAP(): Promise<KpiMoneyResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("documents")
      .select("id, grand_total, paid_amount, status, payment_status")
      .in("doc_type", [...AP_PENDING_DOC_TYPES])
      .or(OUTSTANDING_STATUS_OR)
      .not("status", "in", '("DRAFT","VOID","CANCELLED")')
      .not("is_voided", "eq", true);

    if (error) {
      console.error("[getPendingAP]", error.message);
      return { amount: 0, error: error.message };
    }

    return {
      amount: sumOutstandingCoalescePaid((data ?? []) as OutstandingDocRow[]),
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to calculate pending AP";
    console.error("[getPendingAP]", message);
    return { amount: 0, error: message };
  }
}

/**
 * YTD Sales — Σ grand_total for INV_DO / TAX_INV / ABB in the current year.
 * Uses `doc_date` (schema column for document_date).
 * Excludes status DRAFT / VOID.
 */
export async function getYTDSales(): Promise<KpiMoneyResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { from, to } = currentYearBounds();

    const { data, error } = await supabaseAdmin
      .from("documents")
      .select("grand_total")
      .in("doc_type", [...YTD_SALES_DOC_TYPES])
      .not("status", "in", '("DRAFT","VOID")')
      .not("is_voided", "eq", true)
      .gte("doc_date", from)
      .lte("doc_date", to);

    if (error) {
      console.error("[getYTDSales]", error.message);
      return { amount: 0, error: error.message };
    }

    const total = ((data ?? []) as SalesDocRow[]).reduce(
      (sum, row) => roundMoney(sum + toMoney(row.grand_total)),
      0,
    );

    return { amount: total, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to calculate YTD sales";
    console.error("[getYTDSales]", message);
    return { amount: 0, error: message };
  }
}
