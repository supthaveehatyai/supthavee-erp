"use server";

/**
 * Phase 14 — Period Closing Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 * Types live in `@/types/accounting-period`.
 */

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { logAuditTrail } from "@/lib/supabase/auditService";
import type {
  AccountingPeriod,
  GetAccountingPeriodsResult,
  SetAccountingPeriodClosedResult,
} from "@/types/accounting-period";

function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      success: false as const,
      error:
        "Missing SUPABASE_SERVICE_ROLE_KEY (หรือ NEXT_PUBLIC_SUPABASE_URL) — ตั้งค่าใน .env.development แล้วรีสตาร์ท next dev",
    };
  }

  return {
    success: true as const,
    client: createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }),
  };
}

function isValidPeriod(year: number, month: number): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    year >= 2000 &&
    year <= 2100 &&
    month >= 1 &&
    month <= 12
  );
}

function mapPeriodRow(row: Record<string, unknown>): AccountingPeriod {
  return {
    id: row.id == null ? null : String(row.id),
    period_year: Number(row.period_year),
    period_month: Number(row.period_month),
    is_closed: Boolean(row.is_closed),
    closed_at: row.closed_at == null ? null : String(row.closed_at),
    closed_by: row.closed_by == null ? null : String(row.closed_by),
  };
}

function buildYearGrid(
  year: number,
  rows: AccountingPeriod[],
): AccountingPeriod[] {
  const byMonth = new Map(rows.map((row) => [row.period_month, row]));
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    return (
      byMonth.get(month) ?? {
        id: null,
        period_year: year,
        period_month: month,
        is_closed: false,
        closed_at: null,
        closed_by: null,
      }
    );
  });
}

/**
 * ดึงงวดบัญชี 12 เดือนของปีที่ระบุ (เดือนที่ยังไม่มีแถว = ยังไม่ปิดงบ)
 */
export async function getAccountingPeriods(
  year?: number,
): Promise<GetAccountingPeriodsResult> {
  try {
    const targetYear = year ?? new Date().getFullYear();
    if (!isValidPeriod(targetYear, 1)) {
      return { success: false, data: [], error: "ปีบัญชีไม่ถูกต้อง" };
    }

    const admin = createSupabaseAdminClient();
    if (!admin.success) {
      return { success: false, data: [], error: admin.error };
    }

    const supabaseAdmin = admin.client;
    const { data, error } = await supabaseAdmin
      .from("accounting_periods")
      .select("id, period_year, period_month, is_closed, closed_at, closed_by")
      .eq("period_year", targetYear)
      .order("period_month", { ascending: true });

    if (error) {
      return { success: false, data: [], error: error.message };
    }

    const rows = (data ?? []).map((row) =>
      mapPeriodRow(row as Record<string, unknown>),
    );

    return { success: true, data: buildYearGrid(targetYear, rows) };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถดึงงวดบัญชีได้";
    return { success: false, data: [], error: message };
  }
}

/**
 * ปิดหรืองเปิดงบรายเดือน — สิทธิ์ Admin เท่านั้น
 */
export async function setAccountingPeriodClosed(input: {
  period_year: number;
  period_month: number;
  is_closed: boolean;
}): Promise<SetAccountingPeriodClosedResult> {
  try {
    const gate = await requireAdmin({
      forbiddenMessage: "Forbidden: เฉพาะ Admin เท่านั้นที่ปิด/เปิดงบได้",
    });
    if (!gate.ok) {
      return { success: false, data: null, error: gate.error };
    }

    const year = Number(input.period_year);
    const month = Number(input.period_month);
    if (!isValidPeriod(year, month)) {
      return { success: false, data: null, error: "ปีหรือเดือนบัญชีไม่ถูกต้อง" };
    }

    const admin = createSupabaseAdminClient();
    if (!admin.success) {
      return { success: false, data: null, error: admin.error };
    }

    const supabaseAdmin = admin.client;
    const nowIso = new Date().toISOString();
    const closedBy = gate.admin.userId;

    const payload = input.is_closed
      ? {
          period_year: year,
          period_month: month,
          is_closed: true,
          closed_at: nowIso,
          closed_by: closedBy,
        }
      : {
          period_year: year,
          period_month: month,
          is_closed: false,
          closed_at: null,
          closed_by: null,
        };

    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("accounting_periods")
      .select("id, period_year, period_month, is_closed, closed_at, closed_by")
      .eq("period_year", year)
      .eq("period_month", month)
      .maybeSingle();

    if (lookupError) {
      return { success: false, data: null, error: lookupError.message };
    }

    const oldRow = existing
      ? mapPeriodRow(existing as Record<string, unknown>)
      : null;

    if (oldRow?.is_closed === input.is_closed && oldRow.id) {
      return { success: true, data: oldRow };
    }

    let saved: Record<string, unknown> | null = null;

    if (existing?.id) {
      const { data, error } = await supabaseAdmin
        .from("accounting_periods")
        .update(payload)
        .eq("id", existing.id)
        .select("id, period_year, period_month, is_closed, closed_at, closed_by")
        .single();

      if (error) {
        return { success: false, data: null, error: error.message };
      }
      saved = data as Record<string, unknown>;
    } else {
      const { data, error } = await supabaseAdmin
        .from("accounting_periods")
        .insert(payload)
        .select("id, period_year, period_month, is_closed, closed_at, closed_by")
        .single();

      if (error) {
        return { success: false, data: null, error: error.message };
      }
      saved = data as Record<string, unknown>;
    }

    const mapped = mapPeriodRow(saved);
    await logAuditTrail(
      "accounting_periods",
      mapped.id ?? `${year}-${String(month).padStart(2, "0")}`,
      existing?.id ? "UPDATE" : "INSERT",
      oldRow,
      mapped,
    );

    revalidatePath("/");

    return { success: true, data: mapped };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถอัปเดตสถานะงวดบัญชีได้";
    return { success: false, data: null, error: message };
  }
}
