/**
 * Phase 14 — Straight-line Depreciation Engine types.
 * Kept outside `"use server"` modules (Turbopack / type separation).
 */

export type CalculateDepreciationResult = {
  success: boolean;
  error: string | null;
  message: string | null;
  processedCount: number | null;
  totalAmount: number | null;
};

/** One posted straight-line depreciation row (joined with accounting period). */
export type AssetDepreciationLedgerRow = {
  id: string;
  asset_id: string;
  period_id: string;
  period_year: number | null;
  period_month: number | null;
  depreciation_date: string;
  depreciation_amount: number;
  accumulated_depreciation: number;
  net_book_value: number;
};

export type GetAssetDepreciationLedgerResult = {
  data: AssetDepreciationLedgerRow[];
  error: string | null;
};
