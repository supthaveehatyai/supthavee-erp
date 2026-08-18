/**
 * Phase 12 — Profit Analysis types.
 * Do NOT put these in `"use server"` files.
 */

export type ProfitMonthKpi = {
  /** YYYY-MM */
  profitMonth: string;
  revenue: number;
  /** ต้นทุนเสื้อเปล่า — Σ (unit_cost_price × qty) */
  productCogs: number;
  /** ค่าแรงงานบริการ — Σ document_items.wage_cost */
  wageCogs: number;
  /** productCogs + wageCogs */
  cogs: number;
  grossProfit: number;
  opex: number;
  netProfit: number;
};

export type SalesProfitRow = {
  documentId: string;
  documentNumber: string;
  documentDate: string;
  docType: string;
  contactName: string;
  revenue: number;
  productCogs: number;
  wageCogs: number;
  /** productCogs + wageCogs */
  cogs: number;
  grossProfit: number;
  /** Gross Profit / Revenue × 100 — null when revenue is 0 */
  gpMarginPercent: number | null;
};

export type ProfitAnalysisDashboardResult = {
  success: true;
  month: string;
  kpi: ProfitMonthKpi;
  rows: SalesProfitRow[];
} | {
  success: false;
  month: string;
  error: string;
};
