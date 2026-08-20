"use server";

/**
 * Phase 14 — Period Closing Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 * Types live in `@/types/accounting-period`.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { logAuditTrail } from "@/lib/supabase/auditService";
import { createClient } from "@/lib/supabase/server-admin";
import type {
  AccountingPeriodListItem,
  AccountingPeriodWritePayload,
  CreateAccountingPeriodResult,
  GetAccountingPeriodsResult,
  TogglePeriodStatusResult,
} from "@/types/accounting-period";

const ACCOUNTING_PERIODS_PATH = "/accounting-periods";

const PERIOD_SELECT =
  "id, period_year, period_month, is_closed, closed_at, closed_by" as const;

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

function mapPeriodRow(row: Record<string, unknown>): AccountingPeriodListItem {
  return {
    id: String(row.id),
    period_year: Number(row.period_year),
    period_month: Number(row.period_month),
    is_closed: Boolean(row.is_closed),
    closed_at: row.closed_at == null ? null : String(row.closed_at),
    closed_by: row.closed_by == null ? null : String(row.closed_by),
    closed_by_name: null,
    closed_by_email: null,
  };
}

async function resolveClosedByDisplay(
  periods: AccountingPeriodListItem[],
): Promise<AccountingPeriodListItem[]> {
  const userIds = [
    ...new Set(
      periods
        .map((row) => row.closed_by)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (userIds.length === 0) {
    return periods;
  }

  const supabaseAdmin = createClient();
  const { data: profiles } = await supabaseAdmin
    .from("user_profiles")
    .select("id, full_name, email")
    .in("id", userIds);

  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile]),
  );

  return periods.map((period) => {
    if (!period.closed_by) return period;
    const profile = profileMap.get(period.closed_by);
    return {
      ...period,
      closed_by_name: profile?.full_name?.trim() || null,
      closed_by_email: profile?.email?.trim() || null,
    };
  });
}

function revalidateAccountingPeriodCaches() {
  revalidatePath(ACCOUNTING_PERIODS_PATH);
  revalidatePath(ACCOUNTING_PERIODS_PATH, "layout");
}

async function persistPeriodClosedState(input: {
  periodId: string;
  period_year: number;
  period_month: number;
  is_closed: boolean;
  closedBy: string | null;
}): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  const supabaseAdmin = createClient();
  const nowIso = new Date().toISOString();

  const updatePayload: AccountingPeriodWritePayload = input.is_closed
    ? {
        period_year: input.period_year,
        period_month: input.period_month,
        is_closed: true,
        closed_at: nowIso,
        ...(input.closedBy ? { closed_by: input.closedBy } : {}),
      }
    : {
        period_year: input.period_year,
        period_month: input.period_month,
        is_closed: false,
        closed_at: null,
        closed_by: null,
      };

  const { data, error } = await supabaseAdmin
    .from("accounting_periods")
    .update(updatePayload)
    .eq("id", input.periodId)
    .select(PERIOD_SELECT)
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as Record<string, unknown>, error: null };
}

/**
 * ดึงงวดบัญชีทั้งหมด เรียงจากปี-เดือนล่าสุดลงมา
 */
export async function getAccountingPeriods(): Promise<GetAccountingPeriodsResult> {
  try {
    const gate = await requireAdmin({
      forbiddenMessage: "Forbidden: เฉพาะ Admin เท่านั้นที่เข้าถึง Period Lock ได้",
    });
    if (!gate.ok) {
      return { success: false, data: [], error: gate.error };
    }

    const supabaseAdmin = createClient();
    const { data, error } = await supabaseAdmin
      .from("accounting_periods")
      .select(PERIOD_SELECT)
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false });

    if (error) {
      return { success: false, data: [], error: error.message };
    }

    const rows = (data ?? []).map((row) =>
      mapPeriodRow(row as Record<string, unknown>),
    );
    const enriched = await resolveClosedByDisplay(rows);

    return { success: true, data: enriched };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถดึงงวดบัญชีได้";
    return { success: false, data: [], error: message };
  }
}

/**
 * สลับสถานะเปิด/ปิดงวดบัญชี — Admin เท่านั้น
 */
export async function togglePeriodStatus(
  periodId: string,
  currentStatus: boolean,
): Promise<TogglePeriodStatusResult> {
  try {
    const gate = await requireAdmin({
      forbiddenMessage: "Forbidden: เฉพาะ Admin เท่านั้นที่ปิด/เปิดงบได้",
    });
    if (!gate.ok) {
      return { success: false, data: null, error: gate.error };
    }

    const trimmedId = periodId.trim();
    if (!trimmedId) {
      return { success: false, data: null, error: "ไม่พบรหัสงวดบัญชี" };
    }

    const supabaseAdmin = createClient();
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("accounting_periods")
      .select(PERIOD_SELECT)
      .eq("id", trimmedId)
      .maybeSingle();

    if (lookupError) {
      return { success: false, data: null, error: lookupError.message };
    }
    if (!existing) {
      return { success: false, data: null, error: "ไม่พบงวดบัญชีที่ระบุ" };
    }

    const oldRow = mapPeriodRow(existing as Record<string, unknown>);
    const nextClosed = !currentStatus;

    if (oldRow.is_closed === nextClosed) {
      const [enriched] = await resolveClosedByDisplay([oldRow]);
      return { success: true, data: enriched };
    }

    const { data: saved, error: saveError } = await persistPeriodClosedState({
      periodId: trimmedId,
      period_year: oldRow.period_year,
      period_month: oldRow.period_month,
      is_closed: nextClosed,
      closedBy: gate.admin.userId,
    });

    if (saveError || !saved) {
      return {
        success: false,
        data: null,
        error: saveError ?? "ไม่สามารถอัปเดตสถานะงวดบัญชีได้",
      };
    }

    const mapped = mapPeriodRow(saved);
    const [enriched] = await resolveClosedByDisplay([mapped]);

    await logAuditTrail(
      "accounting_periods",
      enriched.id,
      "UPDATE",
      oldRow,
      enriched,
    );

    revalidateAccountingPeriodCaches();

    return { success: true, data: enriched };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถอัปเดตสถานะงวดบัญชีได้";
    return { success: false, data: null, error: message };
  }
}

/**
 * สร้างงวดบัญชีใหม่ (เริ่มต้นสถานะเปิด)
 */
export async function createAccountingPeriod(
  year: number,
  month: number,
): Promise<CreateAccountingPeriodResult> {
  try {
    const gate = await requireAdmin({
      forbiddenMessage: "Forbidden: เฉพาะ Admin เท่านั้นที่สร้างงวดบัญชีได้",
    });
    if (!gate.ok) {
      return { success: false, data: null, error: gate.error };
    }

    const periodYear = Number(year);
    const periodMonth = Number(month);
    if (!isValidPeriod(periodYear, periodMonth)) {
      return { success: false, data: null, error: "ปีหรือเดือนบัญชีไม่ถูกต้อง" };
    }

    const supabaseAdmin = createClient();
    const { data: duplicate, error: duplicateError } = await supabaseAdmin
      .from("accounting_periods")
      .select("id")
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth)
      .maybeSingle();

    if (duplicateError) {
      return { success: false, data: null, error: duplicateError.message };
    }
    if (duplicate?.id) {
      return {
        success: false,
        data: null,
        error: `งวด ${periodMonth}/${periodYear} มีอยู่ในระบบแล้ว`,
      };
    }

    const insertPayload: AccountingPeriodWritePayload = {
      period_year: periodYear,
      period_month: periodMonth,
      is_closed: false,
    };

    const { data, error } = await supabaseAdmin
      .from("accounting_periods")
      .insert(insertPayload)
      .select(PERIOD_SELECT)
      .single();

    if (error) {
      return { success: false, data: null, error: error.message };
    }

    const mapped = mapPeriodRow(data as Record<string, unknown>);
    const [enriched] = await resolveClosedByDisplay([mapped]);

    await logAuditTrail(
      "accounting_periods",
      enriched.id,
      "INSERT",
      null,
      enriched,
    );

    revalidateAccountingPeriodCaches();

    return { success: true, data: enriched };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถสร้างงวดบัญชีได้";
    return { success: false, data: null, error: message };
  }
}
