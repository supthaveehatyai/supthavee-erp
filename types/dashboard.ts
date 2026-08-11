/**
 * Executive Dashboard KPI types — safe for Client + Server.
 * Do NOT put these in `"use server"` files (Next.js forbids exporting types from them).
 */

/** Money KPI result — amount is always a finite number (0 on error/empty). */
export type KpiMoneyResult = {
  amount: number;
  error: string | null;
};

/** True Net Profit KPI — Sales − wage COGS − OPEX. */
export type ProfitabilityKpiResult = {
  /** Σ expenses.net_amount · ISSUED · YTD */
  totalExpenses: number;
  /**
   * YTD Sales − production_jobs.wage_cost (COGS เพิ่มจากค่าแรงช่าง)
   */
  grossProfit: number;
  /** grossProfit − totalExpenses */
  netProfit: number;
  error: string | null;
};
