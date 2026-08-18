/**
 * Executive Dashboard KPI types — safe for Client + Server.
 * Do NOT put these in `"use server"` files (Next.js forbids exporting types from them).
 */

/** Money KPI result — amount is always a finite number (0 on error/empty). */
export type KpiMoneyResult = {
  amount: number;
  error: string | null;
};

/** True Net Profit KPI — Net Revenue − (product COGS + wage_cost) − OPEX. */
export type ProfitabilityKpiResult = {
  /** Σ expenses.net_payable · ISSUED · YTD (จาก vw_monthly_profit_summary) */
  totalExpenses: number;
  /** Σ product cost snapshot · YTD */
  productCogs: number;
  /** Σ production_jobs.wage_cost · YTD */
  wageCogs: number;
  /** productCogs + wageCogs */
  totalCogs: number;
  /**
   * YTD Net Revenue − Actual COGS (เสื้อเปล่า + ค่าแรงงานบริการ)
   */
  grossProfit: number;
  /** grossProfit − totalExpenses */
  netProfit: number;
  error: string | null;
};
