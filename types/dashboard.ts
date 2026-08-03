/**
 * Executive Dashboard KPI types — safe for Client + Server.
 * Do NOT put these in `"use server"` files (Next.js forbids exporting types from them).
 */

/** Money KPI result — amount is always a finite number (0 on error/empty). */
export type KpiMoneyResult = {
  amount: number;
  error: string | null;
};

/** True Net Profit KPI — Sales (gross proxy) − OPEX. */
export type ProfitabilityKpiResult = {
  /** Σ expenses.net_amount · ISSUED · YTD */
  totalExpenses: number;
  /**
   * Gross base for Phase 8 — currently YTD Sales (pre-COGS).
   * When Cost Snapshot lands, replace with Sales − COGS.
   */
  grossProfit: number;
  /** grossProfit − totalExpenses */
  netProfit: number;
  error: string | null;
};
