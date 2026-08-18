"use server";

/**
 * Phase 12 — Profit Analysis Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 * Types live in `@/types/profit-analysis` (never export types from this file).
 */

import { createClient } from "@/lib/supabase/server-admin";
import type {
  ProfitAnalysisDashboardResult,
  ProfitMonthKpi,
  SalesProfitRow,
} from "@/types/profit-analysis";

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Validate / normalize `YYYY-MM`. Falls back to current calendar month. */
function normalizeProfitMonth(rawMonth?: string | null): string {
  const now = new Date();
  const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const trimmed = rawMonth?.trim() ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

function monthDateBounds(month: string): { from: string; toExclusive: string } {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const from = `${month}-01`;
  const next = new Date(year, monthIndex + 1, 1);
  const toExclusive = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
  return { from, toExclusive };
}

function emptyKpi(month: string): ProfitMonthKpi {
  return {
    profitMonth: month,
    revenue: 0,
    productCogs: 0,
    wageCogs: 0,
    cogs: 0,
    grossProfit: 0,
    opex: 0,
    netProfit: 0,
  };
}

/**
 * Monthly KPI from `vw_monthly_profit_summary` for a given `YYYY-MM`.
 */
export async function getMonthlyProfitKpi(
  month: string,
): Promise<{ data: ProfitMonthKpi; error: string | null }> {
  try {
    const profitMonth = normalizeProfitMonth(month);
    const supabaseAdmin = createClient();

    const { data, error } = await supabaseAdmin
      .from("vw_monthly_profit_summary")
      .select(
        "profit_month, revenue, product_cogs, wage_cogs, cogs, gross_profit, opex, net_profit",
      )
      .eq("profit_month", profitMonth)
      .maybeSingle();

    if (error) {
      console.error("[getMonthlyProfitKpi]", error.message);
      return { data: emptyKpi(profitMonth), error: error.message };
    }

    if (!data) {
      return { data: emptyKpi(profitMonth), error: null };
    }

    return {
      data: {
        profitMonth,
        revenue: roundMoney(toMoney(data.revenue)),
        productCogs: roundMoney(toMoney(data.product_cogs)),
        wageCogs: roundMoney(toMoney(data.wage_cogs)),
        cogs: roundMoney(toMoney(data.cogs)),
        grossProfit: roundMoney(toMoney(data.gross_profit)),
        opex: roundMoney(toMoney(data.opex)),
        netProfit: roundMoney(toMoney(data.net_profit)),
      },
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load monthly profit KPI";
    console.error("[getMonthlyProfitKpi]", message);
    return { data: emptyKpi(normalizeProfitMonth(month)), error: message };
  }
}

/**
 * Per-document sales profit rows for a given `YYYY-MM`
 * from `vw_sales_profit_analysis`.
 */
export async function getSalesProfitRows(
  month: string,
): Promise<{ data: SalesProfitRow[]; error: string | null }> {
  try {
    const profitMonth = normalizeProfitMonth(month);
    const { from, toExclusive } = monthDateBounds(profitMonth);
    const supabaseAdmin = createClient();

    const { data, error } = await supabaseAdmin
      .from("vw_sales_profit_analysis")
      .select(
        "document_id, document_number, document_date, doc_type, contact_name, net_revenue, product_cogs, wage_cogs, total_cogs",
      )
      .gte("document_date", from)
      .lt("document_date", toExclusive)
      .order("document_date", { ascending: false })
      .order("document_number", { ascending: false });

    if (error) {
      console.error("[getSalesProfitRows]", error.message);
      return { data: [], error: error.message };
    }

    const rows: SalesProfitRow[] = (data ?? []).map((row) => {
      const revenue = roundMoney(toMoney(row.net_revenue));
      const productCogs = roundMoney(toMoney(row.product_cogs));
      const wageCogs = roundMoney(toMoney(row.wage_cogs));
      const cogs = roundMoney(toMoney(row.total_cogs));
      const grossProfit = roundMoney(revenue - cogs);
      const gpMarginPercent =
        revenue === 0 ? null : roundPercent((grossProfit / revenue) * 100);

      return {
        documentId: String(row.document_id ?? ""),
        documentNumber: String(row.document_number ?? "—"),
        documentDate: String(row.document_date ?? ""),
        docType: String(row.doc_type ?? ""),
        contactName: String(row.contact_name ?? "—"),
        revenue,
        productCogs,
        wageCogs,
        cogs,
        grossProfit,
        gpMarginPercent,
      };
    });

    return { data: rows, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load sales profit rows";
    console.error("[getSalesProfitRows]", message);
    return { data: [], error: message };
  }
}

/**
 * Combined dashboard payload for the Profit Analysis page.
 */
export async function getProfitAnalysisDashboard(
  rawMonth?: string | null,
): Promise<ProfitAnalysisDashboardResult> {
  const month = normalizeProfitMonth(rawMonth);

  try {
    const [kpiResult, rowsResult] = await Promise.all([
      getMonthlyProfitKpi(month),
      getSalesProfitRows(month),
    ]);

    const errors = [kpiResult.error, rowsResult.error].filter(
      (msg): msg is string => Boolean(msg),
    );

    if (errors.length > 0) {
      return {
        success: false,
        month,
        error: errors.join(" · "),
      };
    }

    return {
      success: true,
      month,
      kpi: kpiResult.data,
      rows: rowsResult.data,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to load profit analysis dashboard";
    console.error("[getProfitAnalysisDashboard]", message);
    return { success: false, month, error: message };
  }
}
