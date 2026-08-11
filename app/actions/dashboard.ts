"use server";

/**
 * Phase 6/8 — Executive Dashboard Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 * Types live in `@/types/dashboard` and `@/types/audit` (never export types here).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/types/supabase";
import type {
  KpiMoneyResult,
  ProfitabilityKpiResult,
} from "@/types/dashboard";

type AdminClient = SupabaseClient<Database>;

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

type ExpenseNetRow = {
  net_amount: number | string | null;
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

/**
 * YTD Operating Expenses (OPEX) — Σ expenses.net_amount.
 * Critical filters: status = ISSUED · expense_date in current calendar year.
 * DRAFT / VOID excluded by the ISSUED filter.
 */
export async function getYTDExpenses(): Promise<KpiMoneyResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { from, to } = currentYearBounds();

    const { data, error } = await supabaseAdmin
      .from("expenses")
      .select("net_amount")
      .eq("status", "ISSUED")
      .gte("expense_date", from)
      .lte("expense_date", to);

    if (error) {
      console.error("[getYTDExpenses]", error.message);
      return { amount: 0, error: error.message };
    }

    const total = ((data ?? []) as ExpenseNetRow[]).reduce(
      (sum, row) => roundMoney(sum + toMoney(row.net_amount)),
      0,
    );

    return { amount: total, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to calculate YTD expenses";
    console.error("[getYTDExpenses]", message);
    return { amount: 0, error: message };
  }
}

const YTD_WAGE_DOC_TYPES = ["INV_DO", "TAX_INV", "ABB", "CS_TAX"] as const;

/**
 * YTD ค่าแรงช่าง (COGS) — Σ production_jobs.wage_cost
 * ของงานที่ไม่ถูกยกเลิก และผูกเอกสารขาย ISSUED ในปีปฏิทินปัจจุบัน
 */
async function getYTDWageCost(): Promise<KpiMoneyResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { from, to } = currentYearBounds();

    const { data, error } = await supabaseAdmin
      .from("production_jobs")
      .select(
        "wage_cost, documents!production_jobs_document_id_fkey ( doc_date, status, doc_type )",
      )
      .neq("status", "CANCELLED");

    if (error) {
      console.error("[getYTDWageCost]", error.message);
      return { amount: 0, error: error.message };
    }

    type WageDocJoin = {
      doc_date?: string | null;
      status?: string | null;
      doc_type?: string | null;
    };

    type WageRow = {
      wage_cost: number | string | null;
      documents: WageDocJoin | WageDocJoin[] | null;
    };

    let total = 0;
    for (const row of (data ?? []) as WageRow[]) {
      const doc = Array.isArray(row.documents)
        ? (row.documents[0] ?? null)
        : row.documents;
      if (!doc) continue;
      if (doc.status !== "ISSUED") continue;
      if (!YTD_WAGE_DOC_TYPES.includes(doc.doc_type as (typeof YTD_WAGE_DOC_TYPES)[number])) {
        continue;
      }
      const docDate = String(doc.doc_date ?? "").slice(0, 10);
      if (docDate < from || docDate > to) continue;
      total = roundMoney(total + toMoney(row.wage_cost));
    }

    return { amount: total, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to calculate YTD wage cost";
    console.error("[getYTDWageCost]", message);
    return { amount: 0, error: message };
  }
}

/**
 * True Net Profit — YTD Sales − wage_cost (COGS) − OPEX.
 */
export async function getTrueNetProfit(): Promise<ProfitabilityKpiResult> {
  try {
    const [sales, expenses, wages] = await Promise.all([
      getYTDSales(),
      getYTDExpenses(),
      getYTDWageCost(),
    ]);

    const errors = [sales.error, expenses.error, wages.error].filter(
      (msg): msg is string => Boolean(msg),
    );
    const grossProfit = roundMoney(sales.amount - wages.amount);
    const totalExpenses = roundMoney(expenses.amount);
    const netProfit = roundMoney(grossProfit - totalExpenses);

    return {
      totalExpenses,
      grossProfit,
      netProfit,
      error: errors.length > 0 ? errors.join(" · ") : null,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to calculate true net profit";
    console.error("[getTrueNetProfit]", message);
    return {
      totalExpenses: 0,
      grossProfit: 0,
      netProfit: 0,
      error: message,
    };
  }
}
